"""
DELETE /api/account must require the account's current password.

A valid access token proves a session exists, not that its owner is the one
asking, so a stolen or left-open session must not be enough to delete the
account. Runs offline: Supabase is stubbed, like test_isolation.py.
"""
import os
import sys

for _k in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
    os.environ[_k] = ""
os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("TAVILY_API_KEY", "test")
os.environ["RATE_LIMIT_ENABLED"] = "false"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402

ALICE = "11111111-1111-1111-1111-111111111111"
CORRECT = "correct horse battery staple"

client = TestClient(main.app, raise_server_exceptions=False)
failures = []
deleted = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


class FakeAdminAPI:
    def delete_user(self, uid):
        deleted.append(uid)


class FakeAdminClient:
    class auth:
        admin = FakeAdminAPI()


main.get_admin_client = lambda: FakeAdminClient()
main._password_matches = lambda uid, pw: uid == ALICE and pw == CORRECT
main.app.dependency_overrides[main.get_current_user] = \
    lambda: main.AuthedUser(id=ALICE, token="stub-token")

print("\n[1] Missing password is rejected before anything is deleted")
r = client.request("DELETE", "/api/account")
check(f"no body -> {r.status_code}", r.status_code == 422)
r = client.request("DELETE", "/api/account", json={"password": ""})
check(f"empty password -> {r.status_code}", r.status_code == 422)
check("nothing deleted", deleted == [], str(deleted))

print("\n[2] Wrong password is a 403 and deletes nothing")
r = client.request("DELETE", "/api/account", json={"password": "guess"})
check(f"wrong password -> {r.status_code}", r.status_code == 403)
check("nothing deleted", deleted == [], str(deleted))

print("\n[3] Correct password deletes exactly the caller's account")
r = client.request("DELETE", "/api/account", json={"password": CORRECT})
check(f"correct password -> {r.status_code}", r.status_code == 200, r.text[:120])
check("deleted the caller", deleted == [ALICE], str(deleted))

main.app.dependency_overrides.clear()
print(f"\n{'ALL PASSED' if not failures else f'{len(failures)} FAILED: {failures}'}")
sys.exit(1 if failures else 0)
