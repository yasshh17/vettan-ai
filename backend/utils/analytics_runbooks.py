"""
Logic for the analytics runbook scripts in backend/scripts. Run by hand, from a
trusted machine. See docs/analytics-operations.md. Never print a secret.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Set

from utils import analytics_keys

LOST_CONFIRMATION = "I-HAVE-LOST-THE-ANALYTICS-ID-SECRET"
PAGE_SIZE = 1000


def require_secret(secret: Optional[bytes]) -> bytes:
    if not secret or len(secret) < analytics_keys.MIN_SECRET_LENGTH:
        raise ValueError(f"secret must be at least {analytics_keys.MIN_SECRET_LENGTH} characters")
    return secret


def secret_from_env(name: str) -> bytes:
    return require_secret(os.getenv(name, "").strip().encode())


def _all_rows(query_factory: Any) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    while True:
        batch = query_factory().range(len(rows), len(rows) + PAGE_SIZE - 1).execute().data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            return rows


def _consenting_users(client: Any) -> Set[str]:
    rows = _all_rows(lambda: client.table("analytics_consent").select("user_id").eq("granted", True).order("user_id"))
    return {row["user_id"] for row in rows}


def _users_with_open_erasure(client: Any) -> Set[str]:
    rows = _all_rows(lambda: client.table("analytics_erasure_requests").select("user_id").order("user_id"))
    return {row["user_id"] for row in rows}


def install_key(
    client: Any, name: str, mode: str, secret: bytes, old_secret: Optional[bytes] = None
) -> None:
    client.rpc("install_analytics_key", {
        "p_name": name,
        "p_fingerprint": analytics_keys.fingerprint(name, require_secret(secret)),
        "p_mode": mode,
        "p_old_fingerprint": analytics_keys.fingerprint(name, old_secret) if old_secret else None,
    }).execute()


def backfill(client: Any, secret: bytes) -> Any:
    """Consenting people only. Everyone else's old rows stay unlinked."""
    require_secret(secret)
    pairs = [
        {"user_id": user_id, "actor_id": analytics_keys.actor_id(user_id, secret)}
        for user_id in sorted(_consenting_users(client))
    ]
    return client.rpc("backfill_analytics_actors", {
        "p_pairs": pairs, "p_fingerprint": analytics_keys.fingerprint("id", secret),
    }).execute().data


def rekey(client: Any, old_secret: bytes, new_secret: bytes) -> None:
    """Linked rows belong to consenting people or a pending erase, so these cover all of them."""
    require_secret(old_secret)
    require_secret(new_secret)
    if old_secret == new_secret:
        raise ValueError("the new secret must differ from the old one")
    users = _consenting_users(client) | _users_with_open_erasure(client)
    pairs = [
        {"old": analytics_keys.actor_id(user_id, old_secret), "new": analytics_keys.actor_id(user_id, new_secret)}
        for user_id in sorted(users)
    ]
    client.rpc("rekey_analytics_actors", {
        "p_pairs": pairs,
        "p_old_fingerprint": analytics_keys.fingerprint("id", old_secret),
        "p_new_fingerprint": analytics_keys.fingerprint("id", new_secret),
    }).execute()


def declare_lost(client: Any, confirmation: str) -> Any:
    """Erases every linked row for everyone. Only for permanent loss of the id secret."""
    if confirmation != LOST_CONFIRMATION:
        raise ValueError("confirmation text does not match")
    return client.rpc("declare_analytics_key_lost", {"p_confirm": confirmation}).execute().data


def export_subject(client: Any, user_id: str, secret: bytes) -> Dict[str, Any]:
    """For an access request: one person's consent record and linked rows."""
    actor_id = analytics_keys.actor_id(user_id, require_secret(secret))
    consent = client.table("analytics_consent").select("*").eq("user_id", user_id).execute().data
    return {
        "consent": consent[0] if consent else None,
        "product_events": _all_rows(
            lambda: client.table("product_events").select("*").eq("actor_id", actor_id).order("id")
        ),
        "analytics_events": _all_rows(
            lambda: client.table("analytics_events").select("*").eq("actor_id", actor_id).order("id")
        ),
    }
