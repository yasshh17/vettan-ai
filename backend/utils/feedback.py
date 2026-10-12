"""Thumbs up/down on answers (migration 0009). Needs the service-role client."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

TABLE = "answer_feedback"
RATINGS = ("up", "down")


def set_rating(
    client: Any,
    user_id: str,
    session_id: str,
    message_id: str,
    rating: Optional[str],
    is_followup: bool = False,
) -> None:
    """None clears the vote."""
    if rating is None:
        client.table(TABLE).delete().eq("user_id", user_id).eq("message_id", message_id).execute()
        return
    if rating not in RATINGS:
        raise ValueError(f"unknown rating {rating!r}")
    client.table(TABLE).upsert(
        {
            "user_id": user_id,
            "session_id": session_id,
            "message_id": message_id,
            "rating": rating,
            "is_followup": is_followup,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="user_id,message_id",
    ).execute()


def ratings_for_session(client: Any, user_id: str, session_id: str) -> Dict[str, str]:
    response = (
        client.table(TABLE)
        .select("message_id,rating")
        .eq("user_id", user_id)
        .eq("session_id", session_id)
        .execute()
    )
    return {row["message_id"]: row["rating"] for row in response.data or []}
