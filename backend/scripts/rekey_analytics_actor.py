"""
Rotates ANALYTICS_ID_SECRET, moving every linked row to the new key.
Set ANALYTICS_ENABLED=false on the backend first. See docs/analytics-operations.md.

    ANALYTICS_ID_SECRET_OLD=... ANALYTICS_ID_SECRET=... python scripts/rekey_analytics_actor.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.supabase_admin_client import get_admin_client  # noqa: E402
from utils import analytics_keys, analytics_runbooks  # noqa: E402


def main() -> None:
    old = analytics_runbooks.secret_from_env(f"{analytics_keys.ID_SECRET_ENV}_OLD")
    new = analytics_runbooks.secret_from_env(analytics_keys.ID_SECRET_ENV)
    analytics_runbooks.rekey(get_admin_client(), old, new)
    print("Re-keyed. Deploy the new secret next.")


if __name__ == "__main__":
    main()
