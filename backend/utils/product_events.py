"""
Product usage events (product_events). Stored only for people who said yes, and
the database checks that again at write time. Event names and props come from
the lists below; anything else is dropped. Never put question, answer, title or
URL text in here. Rules: docs/analytics.md.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Callable, Dict, List, Mapping, Optional

from utils import analytics, analytics_keys

logger = logging.getLogger(__name__)

MAX_BATCH = 20

ROUTES = frozenset({
    "home", "app", "sign_in", "sign_up", "forgot_password", "reset_password",
    "privacy", "terms", "usage_policy", "other",
})
SOURCES = frozenset({"typed", "suggested", "voice"})

# Each prop is a fixed set of choices, bool, or an inclusive (min, max) int range.
SERVER_EVENTS: Dict[str, Dict[str, Any]] = {
    "research_submitted": {"source": SOURCES, "is_followup": bool},
    "audio_generated": {},
    "chat_opened": {},
    "chat_favorited": {"favorite": bool},
    "chat_renamed": {},
    "chat_deleted": {},
}
BROWSER_EVENTS: Dict[str, Dict[str, Any]] = {
    "page_viewed": {"route": ROUTES},
    "signed_in": {},
    "signed_out": {},
    "sources_expanded": {"count": (0, 50)},
    "citation_clicked": {},
    "audio_downloaded": {},
    "history_searched": {},
}


def _allowed(rule: Any, value: Any) -> bool:
    if rule is bool:
        return isinstance(value, bool)
    if isinstance(rule, tuple):
        low, high = rule
        return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high
    return isinstance(value, str) and value in rule


def _visit_id(value: Any) -> Optional[str]:
    """The canonical lower-case UUID, or None if it isn't one."""
    if not isinstance(value, str):
        return None
    try:
        parsed = str(uuid.UUID(value))
    except ValueError:
        return None
    return parsed if parsed == value.lower() else None


def build_event(
    event: str,
    props: Any,
    visit_id: Any = None,
    *,
    server: bool = False,
) -> Optional[Dict[str, Any]]:
    """A clean event, or None. The browser can't send server events, and server events have no visit."""
    rules = (SERVER_EVENTS if server else BROWSER_EVENTS).get(event)
    if rules is None:
        return None
    clean_visit = None
    if not server and visit_id is not None:
        clean_visit = _visit_id(visit_id)
        if clean_visit is None:
            return None
    clean = {}
    if isinstance(props, Mapping):
        for key, value in props.items():
            if key in rules and _allowed(rules[key], value):
                clean[key] = value
    return {"event": event, "props": clean, "visit_id": clean_visit}


class SupabaseProductEventStore:
    """Service role only; 0011 grants anon and authenticated nothing."""

    def __init__(self, client_factory: Callable[[], Any]) -> None:
        self._client_factory = client_factory

    def write(self, user_id: str, actor: str, events: List[Dict[str, Any]]) -> Optional[int]:
        client = self._client_factory()
        if client is None:
            return None
        written = client.rpc("record_product_events", {
            "p_user": user_id,
            "p_actor": actor,
            "p_fingerprint": analytics_keys.fingerprint("id"),
            "p_events": events,
        }).execute().data
        return int(written or 0)


def _admin_client() -> Any:
    from database.supabase_admin_client import get_admin_client

    return get_admin_client()


# Swapped out by tests.
store = SupabaseProductEventStore(_admin_client)


def write(user_id: str, events: List[Dict[str, Any]], *, gpc: bool = False) -> Optional[int]:
    """
    Blocking. Rows written, or None when nothing will be stored for this user
    right now. 0 can also mean consent is off, which the database decides.
    """
    if not analytics.ENABLED or gpc or not user_id or user_id.lower() in analytics.admin_ids():
        return None
    actor = analytics_keys.actor_id(user_id)
    if actor is None:
        return None
    if not events:
        return 0
    return store.write(user_id, actor, events)


def record(event: str, *, user_id: str, gpc: bool = False, **props: Any) -> None:
    """Queue one server event. Never raises or waits on the database."""
    try:
        if not analytics.ENABLED or gpc:
            return
        clean = build_event(event, props, server=True)
        if clean is None:
            logger.warning("Unknown product event dropped")
            return
        analytics.submit(lambda: write(user_id, [clean]), event)
    except Exception as e:
        logger.warning("Product event %s not recorded: %s", event, type(e).__name__)
