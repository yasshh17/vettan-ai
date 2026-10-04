"""
Token-bucket rate limiting, framework-free (HTTP glue is in rate_limit_http.py).

A bucket allows a burst (capacity) and a sustained rate (refill) independently, which
fits this app's traffic: a query, then a few quick follow-ups. Requests are charged by
cost, so one research call can weigh more than one history read.

Two layers: an IP bucket before auth protects the blocking Supabase auth call; a user
bucket after auth protects OpenAI/Tavily spend.
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

# Absorbs float drift so 0.9999999 tokens still counts as 1.
_EPSILON = 1e-9


# Read once at import. A bad value logs and falls back rather than crashing startup.

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


#: Kill switch, used by tests.
ENABLED: bool = _env_bool("RATE_LIMIT_ENABLED", True)

#: Proxies in front of the app. See client_ip().
TRUSTED_HOPS: int = _env_int("RATE_LIMIT_TRUSTED_HOPS", 1)

#: Ceiling on tracked keys, against a source rotating addresses faster than the sweep.
MAX_KEYS: int = _env_int("RATE_LIMIT_MAX_KEYS", 50_000)


@dataclass(frozen=True)
class BucketPolicy:

    name: str
    capacity: float
    refill_per_sec: float

    @property
    def seconds_to_full(self) -> float:
        return self.capacity / self.refill_per_sec


@dataclass(frozen=True)
class Decision:
    allowed: bool
    policy: str
    limit: int
    remaining: int
    #: Seconds until full (delta, not a timestamp, like retry_after).
    reset_seconds: int
    #: 0 when allowed, otherwise >= 1 so clients don't retry instantly.
    retry_after: int


class RateLimitStore(Protocol):
    # Async so a Redis-backed store can implement it.

    async def consume(self, key: str, policy: BucketPolicy, cost: float = 1.0) -> Decision:
        ...


# Sweep cadence, whichever comes first.
_SWEEP_EVERY_N = 512
_SWEEP_EVERY_SECONDS = 60.0


class InMemoryTokenBucketStore:
    """
    Buckets in a dict. Correct for one process only; with several workers each keeps
    its own buckets. The clock must be monotonic, or a backwards clock step mints tokens.
    """

    def __init__(
        self,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = MAX_KEYS,
    ) -> None:
        self._clock = clock
        self._max_keys = max_keys
        # key -> (tokens, updated_at, seconds_to_full); the sweep can't look up policies.
        self._state: Dict[str, Tuple[float, float, float]] = {}
        self._lock = threading.Lock()
        self._since_sweep = 0
        self._last_sweep = clock()
        self._warned_full = False

    async def consume(self, key: str, policy: BucketPolicy, cost: float = 1.0) -> Decision:
        """Charge `cost` to `key`. Must not await: having no suspension point is what makes it atomic."""
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

        # Not needed on the event loop alone, but background tasks run on threads.
        with self._lock:
            tokens, updated, _ = self._state.get(key, (policy.capacity, now, policy.seconds_to_full))

            elapsed = max(0.0, now - updated)
            tokens = min(policy.capacity, tokens + elapsed * policy.refill_per_sec)

            allowed = tokens + _EPSILON >= cost
            if allowed:
                tokens -= cost
                if tokens < 0.0:
                    tokens = 0.0
            # Rejections aren't charged, or a retrying client never recovers.

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

    def _maybe_sweep(self, now: float) -> None:
        """Drop full buckets (lossless: a missing key starts full). Caller holds the lock."""
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

        # Keys arriving faster than they refill: evict the oldest rather than run out of memory.
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

    def tracked_keys(self) -> int:
        with self._lock:
            return len(self._state)


# A research request is ~4 Tavily credits: capacity 20 caps a burst at ~80 credits,
# 10/min refill caps the sustained rate at ~40 credits/min per user.

def _policy(name: str, capacity: float, refill_per_min: float) -> BucketPolicy:
    env = name.upper()
    return BucketPolicy(
        name=name,
        capacity=_env_float(f"RATE_LIMIT_{env}_CAPACITY", capacity),
        refill_per_sec=_env_float(f"RATE_LIMIT_{env}_REFILL_PER_MIN", refill_per_min) / 60.0,
    )


POLICIES: Dict[str, BucketPolicy] = {
    # Pre-auth, by IP. Generous: it guards the auth call, not normal use.
    "ip": _policy("ip", 100, 60),
    # Shared by /api/research and /api/research/stream.
    "research": _policy("research", 20, 10),
    "audio": _policy("audio", 10, 5),
    "read": _policy("read", 60, 60),
    "write": _policy("write", 30, 30),
    "account": _policy("account", 3, 1),
}


class ConcurrencySlots:
    """
    Non-blocking cap on in-flight requests, per key and overall. Buckets limit rate, not
    concurrency, and each research request holds a threadpool slot that auth also needs.
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


def _parse_ip(raw: Optional[str]) -> Optional[ipaddress._BaseAddress]:
    """Parse an address, tolerating a port. None if it isn't an IP."""
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
    """Collapse IPv6 to its /64, since one household owns the whole prefix."""
    if ip.version == 6:
        return str(ipaddress.ip_network(f"{ip}/64", strict=False).network_address)
    return str(ip)


def client_ip(
    headers: Mapping[str, str],
    peer: Optional[str],
    trusted_hops: int = TRUSTED_HOPS,
) -> str:
    """
    The caller's address as a bucket key, counted `trusted_hops` in from the RIGHT of
    X-Forwarded-For. Proxies append, so the leftmost entry is client-controlled.
    `headers` keys must be lowercase; trusted_hops=0 ignores XFF.
    """
    if trusted_hops > 0:
        forwarded = headers.get("x-forwarded-for")
        if forwarded:
            parts = [p.strip() for p in forwarded.split(",") if p.strip()]
            if len(parts) >= trusted_hops:
                ip = _parse_ip(parts[-trusted_hops])
                if ip is not None:
                    return _normalize(ip)
            # Malformed: fall back to the socket peer.

    ip = _parse_ip(peer)
    return _normalize(ip) if ip is not None else "unknown"
