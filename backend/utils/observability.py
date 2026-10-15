"""
Sentry error tracking. Off unless SENTRY_DSN is set.

Questions, answers, tokens and IPs must never leave the app, so the log
integration is off, exception messages are blanked and every event is
scrubbed before it is sent.
"""
from __future__ import annotations

import hashlib
import logging
import os
from typing import Any, Dict, Optional
from urllib.parse import urlsplit, urlunsplit

import sentry_sdk

logger = logging.getLogger(__name__)

_DROP_HEADERS = frozenset({
    "authorization",
    "cookie",
    "set-cookie",
    "x-forwarded-for",
    "x-real-ip",
    "forwarded",
    "true-client-ip",
    "cf-connecting-ip",
})

# Render polls these constantly.
_UNTRACED_PATHS = frozenset({"/", "/health"})

_enabled = False


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "").strip() or default)
    except ValueError:
        logger.warning("%s is not a number; using %s", name, default)
        return default


def hash_user(user_id: Optional[str]) -> Optional[str]:
    if not user_id:
        return None
    salt = os.getenv("AUDIT_IP_SALT", "")
    return hashlib.sha256(f"{salt}:user:{user_id}".encode()).hexdigest()[:16]


def _strip_query(url: Any) -> Any:
    if not isinstance(url, str) or ("?" not in url and "#" not in url):
        return url
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def _scrub_request(request: Dict[str, Any]) -> None:
    for key in ("data", "cookies", "query_string", "env"):
        request.pop(key, None)
    if "url" in request:
        request["url"] = _strip_query(request["url"])
    headers = request.get("headers")
    if isinstance(headers, dict):
        request["headers"] = {
            k: v for k, v in headers.items() if str(k).lower() not in _DROP_HEADERS
        }


def _scrub_data(data: Any) -> None:
    if not isinstance(data, dict):
        return
    data.pop("http.query", None)
    data.pop("http.fragment", None)
    if "url" in data:
        data["url"] = _strip_query(data["url"])


def _scrub_description(description: Any) -> Any:
    if not isinstance(description, str):
        return description
    method, sep, url = description.partition(" ")
    return f"{method}{sep}{_strip_query(url)}" if sep else _strip_query(description)


def scrub_breadcrumb(crumb: Dict[str, Any], hint: Any = None) -> Optional[Dict[str, Any]]:
    if crumb.get("category") == "log" or crumb.get("type") == "log":
        return None
    _scrub_data(crumb.get("data"))
    return crumb


def scrub_event(event: Dict[str, Any], hint: Any = None) -> Dict[str, Any]:
    if isinstance(event.get("request"), dict):
        _scrub_request(event["request"])

    for exc in (event.get("exception") or {}).get("values") or []:
        if exc.get("value"):
            exc["value"] = ""

    user = event.get("user")
    if isinstance(user, dict):
        event["user"] = {"id": user["id"]} if user.get("id") else {}

    crumbs = event.get("breadcrumbs")
    if isinstance(crumbs, dict):
        crumbs["values"] = [
            c for c in (scrub_breadcrumb(c) for c in crumbs.get("values") or []) if c
        ]

    for span in event.get("spans") or []:
        span["description"] = _scrub_description(span.get("description"))
        _scrub_data(span.get("data"))

    return event


def _traces_sampler(context: Dict[str, Any]) -> float:
    if context.get("parent_sampled") is not None:
        return float(context["parent_sampled"])
    scope = context.get("asgi_scope") or {}
    if scope.get("path") in _UNTRACED_PATHS or scope.get("method") == "OPTIONS":
        return 0.0
    return _env_float("SENTRY_TRACES_SAMPLE_RATE", 0.1)


def init_sentry() -> bool:
    """Start Sentry if SENTRY_DSN is set. Returns whether it is on."""
    global _enabled
    dsn = os.getenv("SENTRY_DSN", "").strip()
    if not dsn:
        logger.info("SENTRY_DSN not set: error tracking is off")
        return False

    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.httpx import HttpxIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    sentry_sdk.init(
        dsn=dsn,
        environment=os.getenv("SENTRY_ENVIRONMENT", "").strip() or "production",
        release=(os.getenv("SENTRY_RELEASE") or os.getenv("RENDER_GIT_COMMIT") or "").strip() or None,
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        auto_enabling_integrations=False,
        # Endpoints capture() the cause themselves; reporting the 500 as well
        # would file every failure twice.
        integrations=[
            StarletteIntegration(failed_request_status_codes=set()),
            FastApiIntegration(failed_request_status_codes=set()),
            HttpxIntegration(),
        ],
        disabled_integrations=[LoggingIntegration],
        traces_sampler=_traces_sampler,
        before_send=scrub_event,
        before_send_transaction=scrub_event,
        before_breadcrumb=scrub_breadcrumb,
    )
    _enabled = True
    logger.info("Sentry error tracking is on")
    return True


def is_enabled() -> bool:
    return _enabled


def set_user(user_id: Optional[str]) -> None:
    hashed = hash_user(user_id)
    if _enabled and hashed:
        sentry_sdk.set_user({"id": hashed})


def capture(exc: BaseException) -> None:
    """Report an exception we caught ourselves."""
    if _enabled:
        sentry_sdk.capture_exception(exc)


def alert(message: str) -> None:
    """Report a fixed message as an error. Never pass user content."""
    if _enabled:
        sentry_sdk.capture_message(message, level="error")
