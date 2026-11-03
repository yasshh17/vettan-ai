"""
Consent, erasure and the hourly maintenance task. Rules: docs/analytics.md.
Runbooks: docs/analytics-operations.md.

Consent is enforced in the database at write time, so nothing here can link a
row after a withdrawal. This module only moves people through the lifecycle.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Tuple

from utils import analytics_keys, audit, observability

logger = logging.getLogger(__name__)

TICK_SECONDS = 3600
BAN_DURATION = "876000h"

# Internal targets, never shown to users. An erase has no user-facing deadline.
PURGE_STALE_AFTER = timedelta(hours=30)
ROW_LIMIT_SECONDS = 92 * 86400
ERASURE_ALERT_AFTER = timedelta(hours=24)
ERASURE_STUCK_AFTER = timedelta(hours=72)
ERASURE_URGENT_AFTER = timedelta(days=7)
ESCALATION_REPEAT = timedelta(hours=24)


class ConsentConflict(Exception):
    """A grant while an earlier erase is still pending."""


class SupabasePrivacyStore:
    def __init__(self, client_factory: Callable[[], Any]) -> None:
        self._client_factory = client_factory

    def _client(self) -> Any:
        client = self._client_factory()
        if client is None:
            raise RuntimeError("service-role Supabase client is not configured")
        return client

    def _rpc(self, name: str, **params: Any) -> Any:
        return self._client().rpc(name, params).execute().data

    def _one(self, table: str, user_id: str) -> Optional[Dict[str, Any]]:
        rows = self._client().table(table).select("*").eq("user_id", user_id).limit(1).execute().data
        return rows[0] if rows else None

    def get_consent(self, user_id: str) -> Optional[Dict[str, Any]]:
        return self._one("analytics_consent", user_id)

    def get_request(self, user_id: str) -> Optional[Dict[str, Any]]:
        return self._one("analytics_erasure_requests", user_id)

    def set_consent(self, user_id: str, granted: bool, wording_version: str, source: str) -> Tuple[str, bool]:
        row = self._rpc(
            "set_analytics_consent",
            p_user=user_id, p_granted=granted, p_wording_version=wording_version, p_source=source,
        )[0]
        return row["status"], row["erasure_required"]

    def erase(self, user_id: str, actor_id: str, fingerprint: str) -> bool:
        return bool(self._rpc(
            "erase_linked_analytics", p_user=user_id, p_actor=actor_id, p_fingerprint=fingerprint,
        ))

    def mark_attempt(self, user_id: str, error_code: str) -> None:
        self._rpc("mark_erasure_attempt", p_user=user_id, p_error_code=error_code)

    def mark_escalated(self, user_id: str, when: Optional[datetime] = None) -> None:
        self._rpc("mark_erasure_escalated", p_user=user_id)

    def ack_notice(self, user_id: str) -> None:
        self._rpc("ack_analytics_erasure_notice", p_user=user_id)

    def request_account_erasure(self, user_id: str) -> bool:
        return bool(self._rpc("request_account_erasure", p_user=user_id))

    def delete_account_content(self, user_id: str) -> None:
        self._rpc("delete_account_content", p_user=user_id)

    def open_requests(self) -> List[Dict[str, Any]]:
        return self._client().table("analytics_erasure_requests").select("*").execute().data or []

    def heartbeat(self, name: str, fingerprint: Optional[str]) -> str:
        return self._rpc("analytics_key_heartbeat", p_name=name, p_fingerprint=fingerprint)

    def health(self) -> Dict[str, Any]:
        return self._rpc("analytics_health")


def admin_client() -> Any:
    from database.supabase_admin_client import get_admin_client

    return get_admin_client()


# Swapped out by tests.
store: Any = SupabasePrivacyStore(lambda: admin_client())


def _utc(value: Any) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _error_code(e: Exception) -> str:
    return "key_unavailable" if isinstance(e, _KeyUnavailable) else "database_error"


class _KeyUnavailable(Exception):
    pass


def _erase(user_id: str) -> None:
    actor_id, fingerprint = analytics_keys.actor_id(user_id), analytics_keys.fingerprint("id")
    if not actor_id or not fingerprint:
        raise _KeyUnavailable()
    store.erase(user_id, actor_id, fingerprint)


def _try_erase(user_id: str) -> bool:
    """One attempt. A failure leaves the request pending for the next tick."""
    try:
        _erase(user_id)
        return True
    except Exception as e:
        logger.warning("Analytics erase pending: %s", type(e).__name__)
        try:
            store.mark_attempt(user_id, _error_code(e))
        except Exception as mark_error:
            logger.warning("Analytics erase attempt not recorded: %s", type(mark_error).__name__)
        return False


def consent_status(user_id: str) -> Dict[str, Any]:
    consent = store.get_consent(user_id)
    return {
        "decided": consent is not None,
        "granted": bool(consent and consent.get("granted")),
        "erasure_pending": store.get_request(user_id) is not None,
        "erasure_completed": bool(consent and consent.get("erasure_completed_at")),
    }


def change_consent(user_id: str, granted: bool, wording_version: str, source: str) -> Dict[str, Any]:
    """Withdrawal commits before the erase runs, so a failed erase can't undo it."""
    # The auth callback also runs for password resets, with the old sign-up metadata.
    if source == "signup" and store.get_consent(user_id) is not None:
        return consent_status(user_id)
    status, erasure_required = store.set_consent(user_id, granted, wording_version, source)
    if status == "erasure_pending":
        raise ConsentConflict()
    audit.record(
        "consent_changed", account=observability.hash_user(user_id), granted=granted, source=source,
    )
    if erasure_required:
        _try_erase(user_id)
    return consent_status(user_id)


def ack_notice(user_id: str) -> Dict[str, Any]:
    store.ack_notice(user_id)
    return consent_status(user_id)


def _ban(user_id: str, admin: Any) -> None:
    try:
        admin.auth.admin.update_user_by_id(user_id, {"ban_duration": BAN_DURATION})
    except Exception as e:
        logger.warning("Could not disable an account pending deletion: %s", type(e).__name__)


def _delete_content(user_id: str) -> bool:
    try:
        store.delete_account_content(user_id)
        return True
    except Exception as e:
        logger.warning("Could not delete account content: %s", type(e).__name__)
        return False


def _delete_auth_user(user_id: str, admin: Any) -> bool:
    try:
        admin.auth.admin.delete_user(user_id)
        return True
    except Exception as e:
        logger.warning("Could not delete an auth user: %s", type(e).__name__)
        return False


def delete_account(user_id: str, token: str, admin: Any) -> str:
    """
    'deleted', or 'pending' with the account disabled while the tick finishes it.
    The auth row is the only copy of the id the erase needs, so it goes last.
    """
    needs_erase = store.request_account_erasure(user_id)
    content_gone = _delete_content(user_id)
    erased = not needs_erase or _try_erase(user_id)

    if content_gone and erased and _delete_auth_user(user_id, admin):
        return "deleted"

    # Sign out first: Supabase refuses a banned user's token.
    try:
        admin.auth.admin.sign_out(token, "global")
    except Exception as e:
        logger.warning("Could not revoke sessions: %s", type(e).__name__)
    _ban(user_id, admin)
    audit.record("account_deletion_pending", account=observability.hash_user(user_id))
    return "pending"


def _sweep(admin: Any, now: datetime) -> None:
    urgent: List[str] = []
    for request in store.open_requests():
        user_id = request["user_id"]
        is_account = request.get("kind") == "account"
        pending = request.get("status") == "pending"

        content_gone = True
        if is_account:
            _ban(user_id, admin)
            content_gone = _delete_content(user_id)

        erased = not pending or _try_erase(user_id)
        finished = erased and (not is_account or (content_gone and _delete_auth_user(user_id, admin)))
        if not finished and _due_for_escalation(request, now):
            urgent.append(user_id)

    if urgent:
        observability.alert(
            f"URGENT analytics erasure: {len(urgent)} request(s) pending over 7 days. "
            "Retries continue. See docs/analytics-operations.md."
        )
        for user_id in urgent:
            store.mark_escalated(user_id, now)


def _due_for_escalation(request: Dict[str, Any], now: datetime) -> bool:
    requested = _utc(request.get("requested_at"))
    if requested is None or now - requested < ERASURE_URGENT_AFTER:
        return False
    last = _utc(request.get("escalated_at"))
    return last is None or now - last >= ESCALATION_REPEAT


def problems(health: Dict[str, Any], now: datetime) -> List[str]:
    """Fixed codes only. Shared by the hourly self-check and the health endpoint."""
    found: List[str] = []
    last_purge = _utc(health.get("last_purge_at"))
    if last_purge is None or now - last_purge > PURGE_STALE_AFTER:
        found.append("purge_stale")
    if health.get("last_purge_failed"):
        found.append("purge_failed")
    if any((age or 0) > ROW_LIMIT_SECONDS for age in (health.get("oldest_row_seconds") or {}).values()):
        found.append("row_too_old")

    states = health.get("key_states") or {}
    for name in ("id", "audit"):
        state = states.get(name, "missing")
        if state != "ok":
            found.append(f"key_{name}_{state}")

    pending_age = timedelta(seconds=health.get("oldest_pending_seconds") or 0)
    if health.get("pending_erasures") and pending_age >= ERASURE_ALERT_AFTER:
        found.append("erasure_pending")
        if pending_age >= ERASURE_STUCK_AFTER:
            found.append("erasure_stuck")
        if pending_age >= ERASURE_URGENT_AFTER:
            found.append("erasure_urgent")
    return found


# Alerted codes by UTC day, so a stuck problem repeats daily rather than hourly.
_alerted: Dict[str, date] = {}


def _alert_once_a_day(code: str, today: date) -> None:
    if _alerted.get(code) == today:
        return
    _alerted[code] = today
    observability.alert(f"Analytics health: {code}. See docs/analytics-operations.md.")


def _self_check(now: datetime) -> None:
    today = now.astimezone(timezone.utc).date()
    try:
        found = problems(store.health(), now)
    except Exception as e:
        logger.warning("Analytics health check failed: %s", type(e).__name__)
        found = ["health_check_failed"]
    # The sweep owns the urgent alert, because it repeats per request.
    for code in found:
        if code != "erasure_urgent":
            _alert_once_a_day(code, today)


def _heartbeats() -> None:
    for name in ("id", "audit"):
        try:
            store.heartbeat(name, analytics_keys.fingerprint(name))
        except Exception as e:
            logger.warning("Analytics key heartbeat failed: %s", type(e).__name__)


def tick(now: Optional[datetime] = None) -> None:
    """One maintenance pass. Each step is safe to repeat, and to run on two workers."""
    now = now or datetime.now(timezone.utc)
    admin = admin_client()
    if admin is None:
        return
    _heartbeats()
    try:
        _sweep(admin, now)
    except Exception as e:
        logger.warning("Analytics erasure sweep failed: %s", type(e).__name__)
        observability.capture(e)
    _self_check(now)


async def run_forever() -> None:
    while True:
        try:
            await asyncio.to_thread(tick)
        except Exception as e:
            logger.warning("Analytics maintenance failed: %s", type(e).__name__)
            observability.capture(e)
        await asyncio.sleep(TICK_SECONDS)
