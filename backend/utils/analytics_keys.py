"""
Keyed IDs for analytics. A missing or short secret returns None, and callers
write nothing linked. Never fall back to a raw account id.
Runbooks: docs/analytics-operations.md.
"""
from __future__ import annotations

import hashlib
import hmac
import os
from typing import Optional

ID_SECRET_ENV = "ANALYTICS_ID_SECRET"
AUDIT_SECRET_ENV = "ANALYTICS_AUDIT_LOG_SECRET"
MIN_SECRET_LENGTH = 32

_SECRET_ENVS = {"id": ID_SECRET_ENV, "audit": AUDIT_SECRET_ENV}


def _secret(env: str) -> Optional[bytes]:
    value = os.getenv(env, "").strip()
    return value.encode() if len(value) >= MIN_SECRET_LENGTH else None


def _hmac(secret: bytes, message: str) -> str:
    return hmac.new(secret, message.encode(), hashlib.sha256).hexdigest()


def actor_id(user_id: Optional[str], secret: Optional[bytes] = None) -> Optional[str]:
    secret = secret or _secret(ID_SECRET_ENV)
    if not secret or not user_id:
        return None
    return _hmac(secret, user_id)[:32]


def admin_ref(user_id: Optional[str]) -> Optional[str]:
    """For analytics_access_log only. Its own secret, so it can't be joined with actor_id."""
    secret = _secret(AUDIT_SECRET_ENV)
    if not secret or not user_id:
        return None
    return _hmac(secret, f"admin:{user_id}")[:32]


def fingerprint(name: str, secret: Optional[bytes] = None) -> Optional[str]:
    """Checks that a secret is the installed one, without storing the secret."""
    secret = secret or _secret(_SECRET_ENVS[name])
    if not secret:
        return None
    return _hmac(secret, f"{name}-key-check-v1")
