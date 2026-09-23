"""
Tenant-isolation and schema-readiness tests.

Runs against FastAPI's TestClient with the Supabase env vars cleared, so no
request reaches a real database. No pytest dependency — run it directly:

    python tests/test_isolation.py

Covers:
  1. Every protected route rejects an unauthenticated request with 401.
  2. Malformed Authorization headers are rejected.
  3. The *authenticated* user's id is what reaches the data layer.
  4. Another user's session is a 404 on read, rename and delete (BOLA closed).
  5. `limit` is bounded.
  6. A missing user_id column surfaces as 503, never as an empty history.

(6) is the regression guard. The tenant-isolation change added a hard dependency
on research_sessions.user_id, but the migration had not been applied. Both the
insert and the scoped select raised 42703, both handlers swallowed it, and the
app reported itself healthy while saving nothing and returning an empty list.
An empty history must never be how a schema failure looks.
"""
import os
import sys

# Cleared BEFORE importing main, so no client is ever built. Set to "" rather
# than deleted: main.py (and supabase_client_v2.py) call load_dotenv() on
# import, which — with a real backend/.env on disk — refills any KEY THAT IS
# ABSENT from os.environ (load_dotenv defaults to override=False, implemented
# as os.environ.setdefault). Deleting the key makes it absent again right
# before import runs load_dotenv(), silently undoing this. An empty string is
# still "present", so setdefault leaves it alone, and _connect()'s own
# `if not url or not key` treats "" as absent too — so this gets the isolation
# the comment always claimed, instead of relying on every call site remembering
# to route around the real client.
for _k in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
    os.environ[_k] = ""
os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("TAVILY_API_KEY", "test")

# This file drives the same routes dozens of times from one "client". With rate
# limiting live it would eventually exhaust a bucket and start failing on 429
# instead of on what it is actually checking — and it would do so only once
# enough cases had been added, which is a miserable thing to debug. Limits have
# their own tests in test_rate_limit.py.
os.environ["RATE_LIMIT_ENABLED"] = "false"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402

ALICE = "11111111-1111-1111-1111-111111111111"
MALLORY = "99999999-9999-9999-9999-999999999999"

PROTECTED = [
    ("GET",    "/api/history"),
    ("GET",    "/api/history/abc-123"),
    ("GET",    "/api/history/abc-123/messages"),
    ("PATCH",  "/api/history/abc-123"),
    ("PUT",    "/api/history/abc-123"),
    ("DELETE", "/api/history/abc-123"),
    ("POST",   "/api/research"),
    ("POST",   "/api/research/stream"),
    ("DELETE", "/api/account"),
]

client = TestClient(main.app, raise_server_exceptions=False)
failures = []
calls = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


class FakeDB:
    """Stand-in data layer that records the user_id it was called with."""

    is_connected = True

    def __init__(self, schema_ready=True):
        self.schema_ready = schema_ready

    def check_schema(self):
        # The real client re-probes here so an applied migration is picked up
        # without a restart. The fake's verdict is fixed.
        return self.schema_ready

    def get_recent_sessions(self, user_id, limit=10):
        calls.append(("get_recent_sessions", user_id, limit))
        return []

    def get_session_by_id(self, session_id, user_id):
        calls.append(("get_session_by_id", session_id, user_id))
        return {"id": session_id, "user_id": ALICE, "query": "q"} if user_id == ALICE else None

    def get_conversation_history(self, session_id, user_id):
        calls.append(("get_conversation_history", session_id, user_id))
        if user_id != ALICE:
            return []
        return [{"id": "m1", "role": "user", "content": "q", "created_at": "2026-01-01T00:00:00"}]

    def update_session(self, session_id, update_data, user_id):
        calls.append(("update_session", session_id, user_id))
        return user_id == ALICE

    def delete_session(self, session_id, user_id):
        calls.append(("delete_session", session_id, user_id))
        return user_id == ALICE


def as_user(uid):
    main.app.dependency_overrides[main.get_current_user] = \
        lambda: main.AuthedUser(id=uid, token="stub-token")


def use_db(db):
    main._db_for = lambda user: db


print("\n[1] Unauthenticated requests must be rejected (401)")
for method, path in PROTECTED:
    r = client.request(method, path, json={"query": "hi"})
    check(f"{method:6} {path:34} -> {r.status_code}", r.status_code == 401)

print("\n[2] Malformed / non-bearer Authorization is rejected")
for hdr in ["", "token abc", "Bearer", "Bearer    "]:
    r = client.get("/api/history", headers={"Authorization": hdr} if hdr else {})
    check(f"Authorization={hdr!r:16} -> {r.status_code}", r.status_code == 401)

use_db(FakeDB())

print("\n[3] The authenticated user's id is what reaches the data layer")
as_user(ALICE)
calls.clear()
client.get("/api/history?limit=10")
check("GET /api/history passes user.id", bool(calls) and calls[0][1] == ALICE, str(calls))

calls.clear()
r = client.get("/api/history/sess-1")
check("GET /api/history/{id} as owner -> 200", r.status_code == 200, str(r.status_code))
check("  ...and scoped by user.id",
      any(c[2] == ALICE for c in calls if c[0] == "get_session_by_id"), str(calls))

print("\n[4] Another user's session is a 404, not a 200 (BOLA closed)")
as_user(MALLORY)
for method, path in [
    ("GET",    "/api/history/sess-1"),
    ("PATCH",  "/api/history/sess-1"),
    ("DELETE", "/api/history/sess-1"),
]:
    r = client.request(method, path, json={"query": "pwned"})
    check(f"{method:6} someone else's session -> {r.status_code}", r.status_code == 404, "expected 404")

r = client.get("/api/history/sess-1/messages")
body = r.json() if r.status_code == 200 else {}
check("GET other's /messages returns no messages", body.get("messages", []) == [], str(body)[:120])

print("\n[5] limit is bounded (was unbounded: ?limit=100000 dumped the table)")
as_user(ALICE)
check("limit=100000 -> 422", client.get("/api/history?limit=100000").status_code == 422)
check("limit=0      -> 422", client.get("/api/history?limit=0").status_code == 422)
calls.clear()
client.get("/api/history?limit=100")
check("limit=100    -> accepted", bool(calls) and calls[0][2] == 100, str(calls))

print("\n[6] REGRESSION: a missing user_id column must not look like an empty account")
use_db(FakeDB(schema_ready=False))
as_user(ALICE)

r = client.get("/api/history")
check(f"GET /api/history -> {r.status_code} (must be 503, NOT 200 with [])", r.status_code == 503)
if r.status_code == 200:
    check("  and it did NOT silently return an empty list", False, str(r.json())[:120])
else:
    check("  error names the cause", "user_id" in r.text, r.text[:160])

r = client.post("/api/research", json={"query": "hi"})
check(f"POST /api/research -> {r.status_code} (refuse before doing paid work)", r.status_code == 503)

r = client.post("/api/research/stream", json={"query": "hi"})
check(f"POST /api/research/stream -> {r.status_code}", r.status_code == 503)

# /health must distinguish "reachable" from "usable".
_real_get_db = main.get_database_v2
main.get_database_v2 = lambda: FakeDB(schema_ready=False)
body = client.get("/health").json()
check("GET /health reports degraded", body.get("status") == "degraded", str(body))
check("  schema_ready is False", body.get("schema_ready") is False, str(body))
main.get_database_v2 = _real_get_db

main.app.dependency_overrides.clear()

print("\n" + "=" * 60)
if failures:
    print(f"FAILED ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("All isolation + schema-readiness checks passed.")
