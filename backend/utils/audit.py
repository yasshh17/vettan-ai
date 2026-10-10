"""
Logs a "[Security]" line whenever a guard turns a request away.
Keep query text and answers out of these.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
from typing import Any, Optional

logger = logging.getLogger(__name__)

EVENTS = frozenset({
    "rate_limited",
    "auth_failed",
    "moderation_blocked",
    "moderation_unavailable",
    "spend_cap_hit",
    "spend_alert",
    "inflight_rejected",
    "account_deleted",
})

_IP_SALT: str = os.getenv("AUDIT_IP_SALT", "")


def hash_ip(ip: Optional[str]) -> Optional[str]:
    if not ip:
        return None
    return hashlib.sha256(f"{_IP_SALT}:{ip}".encode()).hexdigest()[:16]


class RedactClientIP(logging.Filter):
    """Swap the client address in Uvicorn's access lines for the same hash record() uses."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and args and isinstance(args[0], str):
            # Uvicorn always appends ":port", with no brackets even for IPv6.
            host = re.sub(r":\d+$", "", args[0])
            record.args = (f"ip={hash_ip(host)}",) + args[1:]
        return True


def record(event: str, *, user_id: Optional[str] = None, ip: Optional[str] = None, **detail: Any) -> None:
    if event not in EVENTS:
        logger.error("Unknown security event %r (not logged)", event)
        return

    fields = {"event": event, "user": (user_id or "-")[:8], "ip": hash_ip(ip) or "-", **detail}
    logger.warning(
        "[Security] %s",
        " ".join(f"{k}={v}" for k, v in fields.items()),
        extra={"security_event": fields},
    )
