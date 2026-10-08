"""
Token-bucket rate limiting, framework-free (HTTP glue is in rate_limit_http.py).

A bucket allows a burst (capacity) and a sustained rate (refill) independently, which
fits this app's traffic: a query, then a few quick follow-ups. Requests are charged by
cost, so one research call can weigh more than one history read.

Two layers: an IP bucket before auth protects the blocking Supabase auth call; a user
bucket after auth protects OpenAI/Tavily spend.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import math
import os
import threading
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Mapping, Optional, Protocol, Set, Tuple

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

    async def consume(self, key: str, policy: BucketPolicy, cost: float = 1.0) -> Decision:
        ...


def _decision(policy: BucketPolicy, allowed: bool, tokens: float, cost: float) -> Decision:
    """`tokens` is what's left after charging."""
    deficit = max(0.0, cost - tokens)
    return Decision(
        allowed=allowed,
        policy=policy.name,
        limit=int(policy.capacity),
        remaining=int(tokens + _EPSILON),
        reset_seconds=max(0, math.ceil((policy.capacity - tokens - _EPSILON) / policy.refill_per_sec)),
        retry_after=0 if allowed else max(1, math.ceil(deficit / policy.refill_per_sec)),
    )


def _open_decision(policy: BucketPolicy) -> Decision:
    return Decision(
        allowed=True,
        policy=policy.name,
        limit=int(policy.capacity),
        remaining=int(policy.capacity),
        reset_seconds=0,
        retry_after=0,
    )


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
            return _open_decision(policy)

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

        return _decision(policy, allowed, tokens, cost)

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


_REDIS_ERROR_LOG_EVERY_SECONDS = 30.0
#: Seconds to skip Redis after an error, so a hung server doesn't slow every request.
REDIS_RETRY_AFTER_SECONDS: float = _env_float("REDIS_RETRY_AFTER_SECONDS", 5.0)
_last_redis_error_log = 0.0
_redis_retry_at = 0.0


def _redis_skipped() -> bool:
    return time.monotonic() < _redis_retry_at


def _log_redis_failure(what: str, exc: BaseException) -> None:
    global _last_redis_error_log, _redis_retry_at
    now = time.monotonic()
    _redis_retry_at = now + REDIS_RETRY_AFTER_SECONDS
    if now - _last_redis_error_log >= _REDIS_ERROR_LOG_EVERY_SECONDS:
        _last_redis_error_log = now
        logger.error("Redis unavailable for %s; using per-process fallback: %r", what, exc)


# Same math as InMemoryTokenBucketStore.consume. Tokens go back as a string because
# Redis turns Lua numbers into integers.
_TOKEN_BUCKET_LUA = """
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local ttl_ms = tonumber(ARGV[5])
local epsilon = tonumber(ARGV[6])
if now < 0 then
  local t = redis.call('TIME')
  now = tonumber(t[1]) + tonumber(t[2]) / 1000000
end
local state = redis.call('HMGET', KEYS[1], 'tokens', 'updated')
local tokens = tonumber(state[1])
local updated = tonumber(state[2])
if tokens == nil or updated == nil then
  tokens = capacity
  updated = now
end
local elapsed = now - updated
if elapsed < 0 then elapsed = 0 end
tokens = math.min(capacity, tokens + elapsed * refill)
local allowed = 0
if tokens + epsilon >= cost then
  allowed = 1
  tokens = tokens - cost
  if tokens < 0 then tokens = 0 end
end
local encoded = string.format('%.17g', tokens)
redis.call('HSET', KEYS[1], 'tokens', encoded, 'updated', string.format('%.17g', now))
redis.call('PEXPIRE', KEYS[1], ttl_ms)
return {allowed, encoded}
"""


class RedisTokenBucketStore:
    """Token buckets shared across processes. Falls back to in-memory ones if Redis is down."""

    def __init__(
        self,
        client: Any,
        fallback: Optional[RateLimitStore] = None,
        key_prefix: str = "rl:",
        clock: Optional[Callable[[], float]] = None,
    ) -> None:
        self._script = client.register_script(_TOKEN_BUCKET_LUA)
        self._fallback = fallback or InMemoryTokenBucketStore()
        self._prefix = key_prefix
        self._clock = clock  # tests only; otherwise Redis TIME is used

    async def consume(self, key: str, policy: BucketPolicy, cost: float = 1.0) -> Decision:
        if not ENABLED:
            return _open_decision(policy)
        if _redis_skipped():
            return await self._fallback.consume(key, policy, cost)

        now = self._clock() if self._clock is not None else -1
        ttl_ms = math.ceil(policy.seconds_to_full * 1000) + 1000
        try:
            allowed, tokens = await self._script(
                keys=[self._prefix + key],
                args=[policy.capacity, policy.refill_per_sec, cost, now, ttl_ms, _EPSILON],
            )
        except Exception as exc:
            _log_redis_failure("rate limiting", exc)
            return await self._fallback.consume(key, policy, cost)

        return _decision(policy, bool(int(allowed)), float(tokens), cost)


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

    async def try_acquire(self, key: str) -> bool:
        return self._try_acquire(key)

    def _try_acquire(self, key: str) -> bool:
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
#: Must outlast a research request. Also how long a crashed worker can hold a slot.
RESEARCH_SLOT_LEASE_SECONDS: float = _env_float("RESEARCH_SLOT_LEASE_SECONDS", 120)


# Sorted set of lease ids, scored by expiry time in ms.
_SLOT_LUA = """
local now = tonumber(ARGV[3])
if now < 0 then
  local t = redis.call('TIME')
  now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then
  return 0
end
local lease_ms = tonumber(ARGV[2])
redis.call('ZADD', KEYS[1], now + lease_ms, ARGV[4])
redis.call('PEXPIRE', KEYS[1], lease_ms)
return 1
"""


class RedisConcurrencySlots:
    """
    Per-user cap shared through Redis leases. The global cap stays per process, since
    it's there to protect this process's threadpool.
    """

    def __init__(
        self,
        client: Any,
        per_key: int,
        total: int,
        lease_seconds: float = RESEARCH_SLOT_LEASE_SECONDS,
        key_prefix: str = "slots:",
        clock_ms: Optional[Callable[[], float]] = None,
    ) -> None:
        self.per_key = per_key
        self.total = total
        self._client = client
        self._script = client.register_script(_SLOT_LUA)
        self._lease_ms = int(lease_seconds * 1000)
        self._prefix = key_prefix
        self._clock_ms = clock_ms  # tests only
        self._bulkhead = ConcurrencySlots(per_key=total, total=total)
        self._fallback = ConcurrencySlots(per_key=per_key, total=total)
        # key -> our lease ids (None = taken from the fallback)
        self._leases: Dict[str, List[Optional[str]]] = {}
        self._pending: Set["asyncio.Task[Any]"] = set()

    async def try_acquire(self, key: str) -> bool:
        if not self._bulkhead._try_acquire(key):
            return False
        if _redis_skipped():
            return self._acquire_fallback(key)

        lease = uuid.uuid4().hex
        now = self._clock_ms() if self._clock_ms is not None else -1
        try:
            granted = await self._script(
                keys=[self._prefix + key],
                args=[self.per_key, self._lease_ms, now, lease],
            )
        except asyncio.CancelledError:
            self._bulkhead.release(key)
            self._remove_lease(key, lease)
            raise
        except Exception as exc:
            _log_redis_failure("research concurrency", exc)
            return self._acquire_fallback(key)

        if not int(granted):
            self._bulkhead.release(key)
            return False
        self._leases.setdefault(key, []).append(lease)
        return True

    def _acquire_fallback(self, key: str) -> bool:
        """Caller holds a bulkhead slot."""
        if self._fallback._try_acquire(key):
            self._leases.setdefault(key, []).append(None)
            return True
        self._bulkhead.release(key)
        return False

    def release(self, key: str) -> None:
        # Not async: it runs in finally blocks that may already be cancelled.
        leases = self._leases.get(key)
        if not leases:
            return
        lease = leases.pop()
        if not leases:
            del self._leases[key]
        self._bulkhead.release(key)
        if lease is None:
            self._fallback.release(key)
        else:
            self._remove_lease(key, lease)

    def _remove_lease(self, key: str, lease: str) -> None:
        task = asyncio.get_running_loop().create_task(self._zrem(key, lease))
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    async def _zrem(self, key: str, lease: str) -> None:
        try:
            await self._client.zrem(self._prefix + key, lease)
        except Exception as exc:
            # The lease still expires on its own.
            _log_redis_failure("research concurrency", exc)

    def in_flight(self) -> int:
        return self._bulkhead.in_flight()


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
