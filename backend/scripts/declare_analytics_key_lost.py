"""
Permanent loss of ANALYTICS_ID_SECRET only: erases every linked analytics row for
everyone, which also lets pending erasures finish. It can't be undone. If the
original secret can still be restored, do that instead.
See docs/analytics-operations.md.

    python scripts/declare_analytics_key_lost.py I-HAVE-LOST-THE-ANALYTICS-ID-SECRET
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database.supabase_admin_client import get_admin_client  # noqa: E402
from utils import analytics_runbooks  # noqa: E402


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    print(analytics_runbooks.declare_lost(get_admin_client(), sys.argv[1]))


if __name__ == "__main__":
    main()
