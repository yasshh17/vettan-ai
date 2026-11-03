"""
Records a secret's fingerprint. Never sends the secret. See docs/analytics-operations.md.

    ANALYTICS_ID_SECRET=... python scripts/install_analytics_key.py id init
    ANALYTICS_AUDIT_LOG_SECRET=... ANALYTICS_AUDIT_LOG_SECRET_OLD=... \
        python scripts/install_analytics_key.py audit rotate
    ANALYTICS_ID_SECRET=... python scripts/install_analytics_key.py id after_loss
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.supabase_admin_client import get_admin_client  # noqa: E402
from utils import analytics_keys, analytics_runbooks  # noqa: E402

ENV = {"id": analytics_keys.ID_SECRET_ENV, "audit": analytics_keys.AUDIT_SECRET_ENV}


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in ENV or sys.argv[2] not in ("init", "rotate", "after_loss"):
        sys.exit(__doc__)
    name, mode = sys.argv[1], sys.argv[2]
    secret = analytics_runbooks.secret_from_env(ENV[name])
    old = analytics_runbooks.secret_from_env(f"{ENV[name]}_OLD") if mode == "rotate" else None
    analytics_runbooks.install_key(get_admin_client(), name, mode, secret, old)
    print(f"Installed the {name} key ({mode}).")


if __name__ == "__main__":
    main()
