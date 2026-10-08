"""
HTTP glue for utils/rate_limit.py: RateLimitMiddleware (by IP, before auth) and
rate_limited() (by user id, after auth).
"""
from __future__ import annotations

import logging
import os
import re
import sys
from typing import Any, Callable, Dict, FrozenSet, Iterable, Optional

from fastapi import Depends, HTTPException, Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from utils import rate_limit
from utils.rate_limit import BucketPolicy, Decision, POLICIES, RateLimitStore, client_ip

logger = logging.getLogger(__name__)

#: Replaced, never appended to, on the way out.
_MANAGED_HEADERS: FrozenSet[bytes] = frozenset(
    (b"x-ratelimit-limit", b"x-ratelimit-remaining", b"x-ratelimit-reset")
)

_DETAIL_PREFIX: Dict[str, str] = {
    "ip": "Too many requests from this address.",
    "research": "Rate limit reached: too many research requests.",
    "audio": "Rate limit reached: too many audio requests.",
    "read": "Rate limit reached.",
    "write": "Rate limit reached.",
    "account": "Rate limit reached: too many account operations.",
}


def _detail(decision: Decision) -> str:
    seconds = decision.retry_after
    unit = "second" if seconds == 1 else "seconds"
    prefix = _DETAIL_PREFIX.get(decision.policy, "Rate limit reached.")
    return f"{prefix} Try again in {seconds} {unit}."


def _limit_headers(decision: Decision) -> Dict[str, str]:
    return {
        "X-RateLimit-Limit": str(decision.limit),
        "X-RateLimit-Remaining": str(decision.remaining),
        "X-RateLimit-Reset": str(decision.reset_seconds),
    }


def _rejection_headers(decision: Decision) -> Dict[str, str]:
    headers = _limit_headers(decision)
    headers["Retry-After"] = str(decision.retry_after)
    return headers


class RateLimitMiddleware:
    """
    IP rate limiter. Raw ASGI rather than BaseHTTPMiddleware, which buffers streaming
    responses. Must be added before CORSMiddleware (see main.py).
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        store: RateLimitStore,
        policy: BucketPolicy,
        trusted_hops: int = rate_limit.TRUSTED_HOPS,
        exempt_paths: Iterable[str] = ("/", "/health"),
    ) -> None:
        self.app = app
        self.store = store
        self.policy = policy
        self.trusted_hops = trusted_hops
        self.exempt_paths = frozenset(exempt_paths)
        self._logged_forwarding = False

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not rate_limit.ENABLED:
            await self.app(scope, receive, send)
            return

        # CORSMiddleware answers real preflights first; this covers malformed ones.
        if scope.get("method") == "OPTIONS" or scope.get("path") in self.exempt_paths:
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        peer = scope["client"][0] if scope.get("client") else None
        self._log_forwarding_once(headers, peer)

        decision = await self.store.consume(f"ip:{client_ip(headers, peer, self.trusted_hops)}", self.policy)

        if not decision.allowed:
            # Can't raise HTTPException here; it would surface as a 500.
            response = JSONResponse(
                {"detail": _detail(decision)},
                status_code=429,
                headers=_rejection_headers(decision),
            )
            await response(scope, receive, send)
            return

        # The user-layer dependency writes its decision into this.
        scope.setdefault("state", {})
        await self.app(scope, receive, self._wrap_send(scope, send, decision))

    def _wrap_send(self, scope: Scope, send: Send, ip_decision: Decision) -> Send:
        """
        Attach X-RateLimit-* here, not in the dependency: FastAPI drops headers set on an
        injected Response when the handler returns a Response itself (the SSE endpoint).
        """

        async def wrapped(message: Message) -> None:
            if message["type"] == "http.response.start":
                # Prefer the user-layer decision; fall back to IP for unauthenticated routes.
                decision = scope.get("state", {}).get("rate_limit") or ip_decision
                kept = [
                    (key, value)
                    for key, value in message.get("headers", [])
                    if key.lower() not in _MANAGED_HEADERS
                ]
                kept.extend(
                    (key.lower().encode("latin-1"), value.encode("latin-1"))
                    for key, value in _limit_headers(decision).items()
                )
                message = {**message, "headers": kept}
            await send(message)

        return wrapped

    def _log_forwarding_once(self, headers: Dict[str, str], peer: Optional[str]) -> None:
        """Log the proxy's header shape once, to check RATE_LIMIT_TRUSTED_HOPS in production."""
        if self._logged_forwarding:
            return
        self._logged_forwarding = True
        logger.info(
            "[RateLimit] first request: peer=%s x-forwarded-for=%r trusted_hops=%d -> key=%s",
            peer,
            headers.get("x-forwarded-for"),
            self.trusted_hops,
            client_ip(headers, peer, self.trusted_hops),
        )


def rate_limited(
    bucket: str,
    auth_dependency: Callable[..., Any],
    store: RateLimitStore,
    cost: float = 1.0,
) -> Callable[..., Any]:
    """
    Wrap an auth dependency so it also charges `bucket`, keyed by the verified user id.
    Runs after auth, so a 401 never costs user tokens. `auth_dependency` is passed in
    to avoid a circular import with main.py.
    """
    policy = POLICIES[bucket]

    async def dependency(request: Request, user: Any = Depends(auth_dependency)) -> Any:
        if not rate_limit.ENABLED:
            return user

        decision = await store.consume(f"{bucket}:{user.id}", policy, cost)
        # Read by RateLimitMiddleware._wrap_send.
        request.state.rate_limit = decision

        if not decision.allowed:
            raise HTTPException(
                status_code=429,
                detail=_detail(decision),
                headers=_rejection_headers(decision),
            )
        return user

    return dependency


def warn_if_multiprocess(log: logging.Logger, shared_store: bool) -> None:
    """Warn if several workers use in-memory buckets, which silently multiplies every limit."""
    if shared_store:
        return
    try:
        concurrency = int(os.getenv("WEB_CONCURRENCY", "1"))
    except (TypeError, ValueError):
        concurrency = 1

    argv = " ".join(sys.argv)
    flagged = "--workers" in argv or re.search(r"(^| )-w[ =]", argv) is not None

    if concurrency > 1 or flagged:
        log.warning(
            "Rate limiting uses an in-process store, but this app appears to be running "
            "with multiple workers (WEB_CONCURRENCY=%s, argv=%r). Each worker keeps its "
            "own buckets, so the effective limits are multiplied by the worker count. "
            "Run a single worker, or set REDIS_URL before scaling out.",
            concurrency,
            argv,
        )
