"""
Links old analytics_events rows to coded IDs, for people who have consented.
Run once, before 0012_drop_analytics_identifiers.sql.

    ANALYTICS_ID_SECRET=... python scripts/backfill_analytics_actor.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.supabase_admin_client import get_admin_client  # noqa: E402
from utils import analytics_keys, analytics_runbooks  # noqa: E402


def main() -> None:
    secret = analytics_runbooks.secret_from_env(analytics_keys.ID_SECRET_ENV)
    updated = analytics_runbooks.backfill(get_admin_client(), secret)
    print(f"Linked {updated} rows.")


if __name__ == "__main__":
    main()
