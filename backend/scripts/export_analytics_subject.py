"""
Prints one person's analytics consent record and linked rows, for an access request.
Prints personal data: send it only to that person.

    ANALYTICS_ID_SECRET=... python scripts/export_analytics_subject.py <user-id>
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.supabase_admin_client import get_admin_client  # noqa: E402
from utils import analytics_keys, analytics_runbooks  # noqa: E402


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    secret = analytics_runbooks.secret_from_env(analytics_keys.ID_SECRET_ENV)
    print(json.dumps(analytics_runbooks.export_subject(get_admin_client(), sys.argv[1], secret), indent=2, default=str))


if __name__ == "__main__":
    main()
