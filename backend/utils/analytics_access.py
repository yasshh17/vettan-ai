"""
analytics_access_log: who read admin analytics, and when. Never whose data
appeared. Fails closed: if the read can't be logged, it isn't served.
Runbooks: docs/analytics-operations.md.
"""
from __future__ import annotations

import hmac
from typing import Any, Dict

from utils import analytics_keys

TABLE = "analytics_access_log"


class AccessLogUnavailable(Exception):
    pass


def record(client: Any, user_id: str, action: str, params: Dict[str, Any]) -> None:
    ref = analytics_keys.admin_ref(user_id)
    expected = analytics_keys.fingerprint("audit")
    if not ref or not expected:
        raise AccessLogUnavailable("audit secret is not set")
    try:
        rows = (
            client.table("analytics_key_check").select("fingerprint,state,epoch")
            .eq("name", "audit").limit(1).execute().data
        )
        key = rows[0] if rows else {}
        # The installed key, not just any value, so entries stay attributable after rotation.
        if key.get("state") != "ok" or not hmac.compare_digest(key.get("fingerprint") or "", expected):
            raise AccessLogUnavailable("audit key is not usable")
        client.table(TABLE).insert({
            "admin_ref": ref, "key_epoch": key["epoch"], "action": action, "params": params,
        }).execute()
    except AccessLogUnavailable:
        raise
    except Exception as e:
        raise AccessLogUnavailable(type(e).__name__) from e
