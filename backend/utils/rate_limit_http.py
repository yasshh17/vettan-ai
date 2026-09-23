"""
HTTP glue for the token buckets in utils/rate_limit.py.

Two enforcement points, because they protect different things:

  RateLimitMiddleware  runs before authentication, keyed by IP. Protects the
                       auth path itself — main.get_current_user makes a
                       blocking Supabase auth.get_user() call on every request
                       via asyncio.to_thread, so an unauthenticated flood still
                       burns a network round trip and a threadpool slot each.

  rate_limited(...)    a FastAPI dependency that runs after authentication,
                       keyed by the verified user id. Protects spend.

The middleware also owns the X-RateLimit-* headers on *successful* responses,
for a reason that is not obvious — see _wrap_send().
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

#: Headers this module owns. Any value already on the response is replaced,
#: never appended to — two competing X-RateLimit-Limit values would be worse
#: than none at all.
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


# ──────────────────────────────────────────────
# Layer 1: pre-auth, keyed by IP
# ──────────────────────────────────────────────

class RateLimitMiddleware:
    """
    Pure-ASGI IP rate limiter.

    Deliberately NOT a BaseHTTPMiddleware subclass. BaseHTTPMiddleware re-pumps
    the response body through an anyio memory stream, which adds a hop for
    every server-sent event on /api/research/stream and has a long history of
    interacting badly with long-lived streams and client-disconnect detection.
    The raw ASGI form costs nothing on a streaming response.

    NOTE ON REGISTRATION ORDER: this must be added to the app *before*
    CORSMiddleware. See the comment at the add_middleware call in main.py.
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

        # A genuine CORS preflight is answered by CORSMiddleware, which sits
        # outside this one, so it never arrives here. Skipping OPTIONS anyway
        # covers malformed preflights and keeps the behaviour explicit rather
        # than emergent.
        if scope.get("method") == "OPTIONS" or scope.get("path") in self.exempt_paths:
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        peer = scope["client"][0] if scope.get("client") else None
        self._log_forwarding_once(headers, peer)

        decision = await self.store.consume(f"ip:{client_ip(headers, peer, self.trusted_hops)}", self.policy)

        if not decision.allowed:
            # Middleware cannot raise HTTPException: ExceptionMiddleware, which
            # turns those into responses, lives *inside* the router stack. A
            # raise from here would surface as a 500 via ServerErrorMiddleware.
            response = JSONResponse(
                {"detail": _detail(decision)},
                status_code=429,
                headers=_rejection_headers(decision),
            )
            await response(scope, receive, send)
            return

        # Give the downstream dependency a dict to write its decision into, so
        # both layers are looking at the same object.
        scope.setdefault("state", {})
        await self.app(scope, receive, self._wrap_send(scope, send, decision))

    def _wrap_send(self, scope: Scope, send: Send, ip_decision: Decision) -> Send:
        """
        Attach X-RateLimit-* to the outgoing response.

        This lives in the middleware rather than the dependency because of a
        FastAPI detail: when a handler returns a Response object directly — as
        /api/research/stream does with StreamingResponse — routing.py takes the
        `isinstance(raw_response, Response)` branch and never reaches the
        `response.headers.raw.extend(sub_response.headers.raw)` line. Headers
        set through an injected Response are silently dropped on exactly the
        endpoint that matters most.

        Reading them off the ASGI message on the way out sidesteps that
        entirely. By the time http.response.start is emitted, the user-layer
        dependency has already run and recorded its decision.
        """

        async def wrapped(message: Message) -> None:
            if message["type"] == "http.response.start":
                # Prefer the user-layer decision: it is the tighter, more
                # meaningful budget. Fall back to the IP layer when the request
                # never reached an authenticated route.
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
        """
        Record the proxy's actual header shape on the first real request.

        RATE_LIMIT_TRUSTED_HOPS is a guess until this is read from a deployed
        instance: if the hop count is wrong the IP layer keys on the wrong
        address, which fails quietly rather than loudly.
        """
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


# ──────────────────────────────────────────────
# Layer 2: post-auth, keyed by user id
# ──────────────────────────────────────────────

def rate_limited(
    bucket: str,
    auth_dependency: Callable[..., Any],
    store: RateLimitStore,
    cost: float = 1.0,
) -> Callable[..., Any]:
    """
    Build a drop-in replacement for the `get_current_user` dependency that also
    charges this request against `bucket`.

    Usage in main.py:

        read_user = rate_limited("read", get_current_user, _rate_limit_store)
        ...
        async def get_history(user: AuthedUser = Depends(read_user)):

    It returns the same AuthedUser, so no handler body changes.

    Why a dependency rather than doing this in the middleware: the middleware
    cannot see the user id, and the alternatives are both bad. Decoding the JWT
    unverified means an attacker mints {"sub": <random uuid>} and gets a fresh
    bucket per request. Decoding it verified means a second, hand-maintained
    copy of the auth path (PyJWT, the signing secret, JWKS rotation) whose
    failure mode is "rate limiting quietly stopped working". Calling Supabase
    again from the middleware doubles the exact cost being protected.

    Three properties make this work:
      * FastAPI caches sub-dependencies per request, so the expensive
        asyncio.to_thread(_verify_access_token) still runs exactly once.
      * dependency_overrides resolve for every node in the dependant tree, so
        tests that override get_current_user keep working through this wrapper.
      * Ordering is structural — this cannot run before auth, because `user` is
        its own parameter. A 401 therefore never consumes a user's tokens.

    `auth_dependency` is passed in rather than imported to avoid a circular
    import between main.py and this module.
    """
    policy = POLICIES[bucket]

    async def dependency(request: Request, user: Any = Depends(auth_dependency)) -> Any:
        if not rate_limit.ENABLED:
            return user

        decision = await store.consume(f"{bucket}:{user.id}", policy, cost)
        # Read back out by RateLimitMiddleware._wrap_send on the way out.
        request.state.rate_limit = decision

        if not decision.allowed:
            raise HTTPException(
                status_code=429,
                detail=_detail(decision),
                headers=_rejection_headers(decision),
            )
        return user

    return dependency


# ──────────────────────────────────────────────
# Deployment guard
# ──────────────────────────────────────────────

def warn_if_multiprocess(log: logging.Logger) -> None:
    """
    Shout if this process looks like one of several workers.

    The in-memory store is correct for exactly one process. Under N workers
    each keeps its own buckets and every limit is silently multiplied by N —
    a failure that produces no error, just limits that do not hold.
    """
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
            "Run a single worker, or implement a shared RateLimitStore (Redis) before "
            "scaling out.",
            concurrency,
            argv,
        )
