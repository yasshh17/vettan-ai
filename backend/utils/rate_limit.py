"""
Token-bucket rate limiting — the framework-free core.

Deliberately imports nothing from fastapi or starlette. The HTTP glue lives in
utils/rate_limit_http.py; everything here is plain Python and directly testable
without a server (see tests/test_rate_limit.py).

WHY A TOKEN BUCKET
------------------
This app's honest traffic is *clustered*: a user lands, fires a query, waits
~15s for the answer, reads it, then fires two or three follow-ups in quick
succession while the context is fresh. A token bucket is the only common
algorithm that gives burst allowance and sustained rate as two independent
knobs — `capacity` for the cluster, `refill_per_sec` for the long run. The
window family (fixed, sliding log, sliding counter) smooths by construction and
would punish exactly that pattern.

It is also a *budget* model rather than an event count, which is what lets a
single bucket be charged different amounts for different work. That matters
here: one /api/research call spends ~4 Tavily credits and two OpenAI calls,
while one /api/history call is a single cheap read. A window counts requests; a
bucket counts cost.

TWO LAYERS, TWO DIFFERENT JOBS
------------------------------
  IP layer   (middleware, pre-auth)  protects the AUTHENTICATION PATH — the
                                     anyio threadpool slot burned by the
                                     blocking Supabase auth.get_user() call
                                     that main.get_current_user makes on every
                                     single request, including ones that turn
                                     out to be unauthenticated.
  User layer (dependency, post-auth) protects SPEND — OpenAI and Tavily
                                     credits. Precise, unspoofable, weighted.

Neither substitutes for the other. The user layer necessarily runs *after* the
token has been verified, so it cannot protect the threadpool; that is inherent
to keying on a verified identity, and it is exactly why the IP layer exists.
"""
from __future__ import annotations

import ipaddress
import logging
import math
import os
import threading
import time
from dataclasses import dataclass
from typing import Callable, Dict, Mapping, Optional, Protocol, Tuple

logger = logging.getLogger(__name__)

# Comparisons and floors are nudged by this so repeated float subtraction can't
# leave a bucket at 0.9999999 tokens and reject a request it should allow.
_EPSILON = 1e-9


# ──────────────────────────────────────────────
# Environment
#
# Read once at import into module constants, so a test can set the variables
# before `import main` and have them take effect. Parsing is deliberately
# forgiving: a typo'd value on Render must log and fall back, never crash the
# app at import time.
# ──────────────────────────────────────────────

def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw)
    except (TypeError, ValueError):
        logger.warning("%s=%r is not a number; using %s", name, raw, default)
        return default
    if value <= 0:
        logger.warning("%s=%r must be positive; using %s", name, raw, default)
        return default
    return value


def _env_int(name: str, default: int) -> int:
    return int(_env_float(name, float(default)))


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() not in ("false", "0", "no", "off")


#: Kill switch. Set RATE_LIMIT_ENABLED=false to make every check a no-op —
#: used by tests/test_isolation.py, which would otherwise exhaust the read
#: bucket as more cases are added to it and fail in a confusing way.
ENABLED: bool = _env_bool("RATE_LIMIT_ENABLED", True)

#: How many proxies sit in front of this app. See client_ip().
TRUSTED_HOPS: int = _env_int("RATE_LIMIT_TRUSTED_HOPS", 1)

#: Hard ceiling on tracked keys, as a last line of defence against a source
#: rotating addresses faster than the sweep can reclaim them.
MAX_KEYS: int = _env_int("RATE_LIMIT_MAX_KEYS", 50_000)


# ──────────────────────────────────────────────
# Types
# ──────────────────────────────────────────────

@dataclass(frozen=True)
class BucketPolicy:
    """One bucket's shape. `name` is only used in log lines and error text."""

    name: str
    capacity: float
    refill_per_sec: float

    @property
    def seconds_to_full(self) -> float:
        """Time for an empty bucket to refill completely. Drives eviction."""
        return self.capacity / self.refill_per_sec


@dataclass(frozen=True)
class Decision:
    """The verdict for one consume() call, plus everything the headers need."""

    allowed: bool
    policy: str
    limit: int
    remaining: int
    #: Seconds until the bucket is *full* again. Delta-seconds, not a Unix
    #: timestamp — same units as retry_after, so the frontend has exactly one
    #: parsing rule and no clock-skew problem. Both conventions exist in the
    #: wild for X-RateLimit-Reset; this codebase picks delta.
    reset_seconds: int
    #: 0 when allowed. When denied, always >= 1: RFC 9110 Retry-After is
    #: integer delta-seconds, and 0 invites an instant retry that fails again.
    retry_after: int


class RateLimitStore(Protocol):
    """
    Where buckets live.

    `consume` is declared async even though the in-memory implementation never
    awaits, because a Redis-backed implementation will have to. Declaring it
    sync now would mean touching every call site later.
    """

    async def consume(self, key: str, policy: BucketPolicy, cost: float = 1.0) -> Decision:
        ...


# ──────────────────────────────────────────────
# In-memory token bucket
# ──────────────────────────────────────────────

# Amortised sweep cadence — whichever comes first.
_SWEEP_EVERY_N = 512
_SWEEP_EVERY_SECONDS = 60.0


class InMemoryTokenBucketStore:
    """
    Token buckets in a plain dict. Correct for a single process.

    backend/Procfile runs one uvicorn worker, so this is globally consistent
    today. Under multiple workers each worker would keep its own buckets and
    the effective limit would multiply by the worker count — see
    warn_if_multiprocess() in rate_limit_http.py, and swap in a shared store
    before scaling out.

    The clock is injected so tests can drive refill deterministically instead
    of sleeping. It must be monotonic: with wall-clock time an NTP step
    backwards would mint tokens out of nowhere.
    """

    def __init__(
        self,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = MAX_KEYS,
    ) -> None:
        self._clock = clock
        self._max_keys = max_keys
        # key -> (tokens, updated_at, seconds_to_full)
        #
        # seconds_to_full is carried per entry rather than looked up from a
        # policy, because the sweep runs over every key at once and has no way
        # to know which policy each one belongs to.
        self._state: Dict[str, Tuple[float, float, float]] = {}
        # Guards _state only. See the locking note in consume().
        self._lock = threading.Lock()
        self._since_sweep = 0
        self._last_sweep = clock()
        self._warned_full = False

    async def consume(self, key: str, policy: BucketPolicy, cost: float = 1.0) -> Decision:
        """
        Charge `cost` against `key`'s bucket and report the verdict.

        INVARIANT — DO NOT ADD AN `await` TO THIS METHOD. An `async def` with
        no suspension point cannot be interleaved by the event loop, which is
        what makes this check-and-consume atomic by construction. Introducing
        an await here would silently make the limiter racy. (The Redis
        implementation will preserve the same property by doing the whole
        read-modify-write inside one Lua script.)
        """
        if not ENABLED:
            return Decision(
                allowed=True,
                policy=policy.name,
                limit=int(policy.capacity),
                remaining=int(policy.capacity),
                reset_seconds=0,
                retry_after=0,
            )

        now = self._clock()

        # The lock is held only across dict get/compute/set — never across an
        # await, never across I/O — so it cannot deadlock and cannot block the
        # event loop. Strictly it is not required today, since every caller
        # runs on the single event-loop thread. It is taken anyway because it
        # matches the _auth_client_lock idiom in main.py, and because this app
        # already runs sync BackgroundTasks on worker threads: the next person
        # to charge a token from one would get silent counter corruption
        # without it. An uncontended acquire costs tens of nanoseconds against
        # a request that makes four Tavily calls.
        with self._lock:
            tokens, updated, _ = self._state.get(key, (policy.capacity, now, policy.seconds_to_full))

            # max(0.0, ...) so a clock that somehow moves backwards stalls
            # refill rather than draining or minting tokens.
            elapsed = max(0.0, now - updated)
            tokens = min(policy.capacity, tokens + elapsed * policy.refill_per_sec)

            allowed = tokens + _EPSILON >= cost
            if allowed:
                tokens -= cost
                if tokens < 0.0:
                    tokens = 0.0
            # A rejected request is NOT charged. Charging on rejection turns a
            # client that is merely hammering into one that can never recover,
            # which is the classic token-bucket footgun.

            self._state[key] = (tokens, now, policy.seconds_to_full)
            self._maybe_sweep(now)

        deficit = max(0.0, cost - tokens)
        return Decision(
            allowed=allowed,
            policy=policy.name,
            limit=int(policy.capacity),
            remaining=int(tokens + _EPSILON),
            reset_seconds=max(0, math.ceil((policy.capacity - tokens - _EPSILON) / policy.refill_per_sec)),
            retry_after=0 if allowed else max(1, math.ceil(deficit / policy.refill_per_sec)),
        )

    # -- eviction ------------------------------------------------------------

    def _maybe_sweep(self, now: float) -> None:
        """
        Drop keys that have refilled to capacity. Caller must hold the lock.

        Without this the dict grows forever — a scanner rotating source
        addresses would eventually exhaust memory on a small dyno.

        The rule is lossless, not a heuristic: a bucket sitting at exactly
        `capacity` is indistinguishable from a key that has never been seen,
        because a missing key is created full. So once `seconds_to_full` has
        elapsed since the last touch, deleting the entry cannot change any
        future verdict.
        """
        self._since_sweep += 1
        if self._since_sweep < _SWEEP_EVERY_N and (now - self._last_sweep) < _SWEEP_EVERY_SECONDS:
            return

        self._since_sweep = 0
        self._last_sweep = now

        stale = [
            key
            for key, (_, updated, seconds_to_full) in self._state.items()
            if (now - updated) >= seconds_to_full
        ]
        for key in stale:
            del self._state[key]

        # Pathological case: keys arriving faster than they refill. Shedding
        # the least recently touched under-limits those callers, which is a
        # better failure than dying.
        overflow = len(self._state) - self._max_keys
        if overflow > 0:
            if not self._warned_full:
                logger.error(
                    "Rate limit store exceeded %d keys after sweeping; evicting the "
                    "%d least recently used. Limits may be under-enforced.",
                    self._max_keys,
                    overflow,
                )
                self._warned_full = True
            oldest = sorted(self._state.items(), key=lambda item: item[1][1])[:overflow]
            for key, _ in oldest:
                del self._state[key]

    # -- introspection, for tests and logging --------------------------------

    def tracked_keys(self) -> int:
        with self._lock:
            return len(self._state)


# ──────────────────────────────────────────────
# Policies
#
# Defaults sized against what one request actually costs. A research request is
# ~4 Tavily credits, so capacity 20 caps a single burst at ~80 credits and the
# 10/min refill caps the sustained rate at ~40 credits/min per user.
# ──────────────────────────────────────────────

def _policy(name: str, capacity: float, refill_per_min: float) -> BucketPolicy:
    env = name.upper()
    return BucketPolicy(
        name=name,
        capacity=_env_float(f"RATE_LIMIT_{env}_CAPACITY", capacity),
        refill_per_sec=_env_float(f"RATE_LIMIT_{env}_REFILL_PER_MIN", refill_per_min) / 60.0,
    )


POLICIES: Dict[str, BucketPolicy] = {
    # Pre-auth, keyed by IP. Generous: it exists to stop a flood from burning
    # Supabase auth calls and threadpool slots, not to meter normal use.
    "ip": _policy("ip", 100, 60),
    # POST /api/research and POST /api/research/stream share this one bucket.
    # Splitting them would hand every user twice the intended budget, and the
    # frontend falls back from the stream to the plain endpoint on failure.
    "research": _policy("research", 20, 10),
    "audio": _policy("audio", 10, 5),
    "read": _policy("read", 60, 60),
    "write": _policy("write", 30, 30),
    # Account deletion loops the Supabase admin API; a handful a day is plenty.
    "account": _policy("account", 3, 1),
}


# ──────────────────────────────────────────────
# Concurrency
# ──────────────────────────────────────────────

class ConcurrencySlots:
    """
    A non-blocking cap on how many requests may be *in flight* at once.

    A token bucket limits rate, not concurrency: at capacity 20 a user can open
    twenty simultaneous research streams inside one second without the bucket
    objecting. Each of those holds an anyio threadpool slot for the history
    read plus three or four concurrent Tavily connections, and the threadpool
    defaults to 40 — so a handful of users doing that stalls *everyone's*
    authentication, since main.get_current_user also needs a thread.

    try_acquire never waits. Blocking would hold the connection open and turn a
    diagnosable 429 into an unexplained hang.
    """

    def __init__(self, per_key: int, total: int) -> None:
        self.per_key = per_key
        self.total = total
        self._held: Dict[str, int] = {}
        self._total_held = 0
        self._lock = threading.Lock()

    def try_acquire(self, key: str) -> bool:
        with self._lock:
            if self._total_held >= self.total:
                logger.warning(
                    "Research concurrency at the global cap (%d); rejecting until one finishes.",
                    self.total,
                )
                return False
            if self._held.get(key, 0) >= self.per_key:
                return False
            self._held[key] = self._held.get(key, 0) + 1
            self._total_held += 1
            return True

    def release(self, key: str) -> None:
        with self._lock:
            current = self._held.get(key, 0)
            if current <= 1:
                self._held.pop(key, None)
            else:
                self._held[key] = current - 1
            if self._total_held > 0:
                self._total_held -= 1

    def in_flight(self) -> int:
        with self._lock:
            return self._total_held


RESEARCH_SLOTS_PER_USER: int = _env_int("RESEARCH_MAX_CONCURRENT_PER_USER", 2)
RESEARCH_SLOTS_GLOBAL: int = _env_int("RESEARCH_MAX_CONCURRENT_GLOBAL", 8)


# ──────────────────────────────────────────────
# Client address
# ──────────────────────────────────────────────

def _parse_ip(raw: Optional[str]) -> Optional[ipaddress._BaseAddress]:
    """Parse one address, tolerating a trailing port. None if it isn't an IP."""
    if not raw:
        return None
    text = raw.strip()
    if not text:
        return None

    if text.startswith("["):                       # [2001:db8::1]:443
        end = text.find("]")
        if end != -1:
            text = text[1:end]
    elif text.count(":") == 1:                     # 203.0.113.7:54321
        text = text.split(":", 1)[0]

    try:
        return ipaddress.ip_address(text)
    except ValueError:
        return None


def _normalize(ip: ipaddress._BaseAddress) -> str:
    """
    Collapse IPv6 to its /64 prefix.

    A residential IPv6 allocation is a /64 or larger, so without this one user
    rotates through addresses they already own and the IP layer is decorative.
    IPv4 is used as-is.
    """
    if ip.version == 6:
        return str(ipaddress.ip_network(f"{ip}/64", strict=False).network_address)
    return str(ip)


def client_ip(
    headers: Mapping[str, str],
    peer: Optional[str],
    trusted_hops: int = TRUSTED_HOPS,
) -> str:
    """
    The caller's address, as a bucket key.

    Reads the RIGHTMOST X-Forwarded-For entry, not the leftmost. This is the
    part that is easy to get silently wrong: XFF is *appended to* by each
    proxy, so if a client sends `X-Forwarded-For: 1.2.3.4` and the edge
    appends, the app sees `1.2.3.4, <real client>`. The near-universal
    `xff.split(",")[0]` then returns attacker-controlled data, and a fresh
    fake address per request bypasses this layer completely.

    Counting `trusted_hops` in from the right is correct when the proxy
    appends, and is *also* correct when the proxy overwrites the header, since
    a single-entry header has leftmost == rightmost. Leftmost is only correct
    in the overwrite case, so rightmost is the safe choice under both.

    `headers` keys must be lowercase. `trusted_hops=0` ignores XFF entirely,
    which is what you want for local development.
    """
    if trusted_hops > 0:
        forwarded = headers.get("x-forwarded-for")
        if forwarded:
            parts = [p.strip() for p in forwarded.split(",") if p.strip()]
            if len(parts) >= trusted_hops:
                ip = _parse_ip(parts[-trusted_hops])
                if ip is not None:
                    return _normalize(ip)
            # Fewer entries than expected, or garbage where an address should
            # be: fall through to the socket peer rather than trusting it. An
            # unvalidated header value must never become a dict key.

    ip = _parse_ip(peer)
    return _normalize(ip) if ip is not None else "unknown"
