"""
get_user_scoped_db() tests: the per-user handle must build and must send the caller's
JWT. A None handle doesn't raise anywhere: history comes back empty and saves are
skipped, which is how supabase 2.32's ClientOptions change shipped unnoticed.

    python tests/test_scoped_db.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# create_client() does no network I/O, so dummy values are enough. JWT-shaped
# because older supabase-py rejects a key that isn't.
os.environ["SUPABASE_URL"] = "https://example.supabase.co"
os.environ["SUPABASE_KEY"] = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.ZHVtbXk"

from database import supabase_client_v2 as db_mod  # noqa: E402

failures = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


def auth_header(db):
    headers = {k.lower(): v for k, v in dict(db.client.postgrest.session.headers).items()}
    return headers.get("authorization")


print("\n[1] A scoped handle is built for a token")

db_mod._scoped_cache.clear()
db = db_mod.get_user_scoped_db("user-a-token")
check("get_user_scoped_db returns a handle", db is not None, str(db))
check("  handle is connected", bool(db and db.is_connected))

print("\n[2] Database requests carry the caller's JWT, not the anon key")

check("PostgREST Authorization is the user's token",
      db is not None and auth_header(db) == "Bearer user-a-token",
      str(db and auth_header(db)))

print("\n[3] Different tokens get different handles")

db_mod._scoped_cache.clear()
a = db_mod.get_user_scoped_db("user-a-token")
b = db_mod.get_user_scoped_db("user-b-token")
check("two tokens, two handles", a is not None and b is not None and a is not b)
check("  second handle sends the second token",
      b is not None and auth_header(b) == "Bearer user-b-token",
      str(b and auth_header(b)))


print("\n" + "=" * 60)
if failures:
    print(f"FAILED ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("All scoped database checks passed.")
