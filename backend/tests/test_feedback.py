"""
Answer feedback tests. No network needed:

    python tests/test_feedback.py
"""
import os
import sys

# Set before importing main (see test_rate_limit.py).
for _k in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
    os.environ[_k] = ""
os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("TAVILY_API_KEY", "test")
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["MODERATION_ENABLED"] = "false"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import re  # noqa: E402
from types import SimpleNamespace as NS  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

failures = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


ALICE = "11111111-1111-1111-1111-111111111111"
BOB = "22222222-2222-2222-2222-222222222222"
ALICE_SESSION = "33333333-3333-3333-3333-333333333333"
BOB_SESSION = "44444444-4444-4444-4444-444444444444"
ANSWER = "55555555-5555-5555-5555-555555555555"
OTHER_ANSWER = "66666666-6666-6666-6666-666666666666"

OWNED = {(ALICE_SESSION, ALICE), (BOB_SESSION, BOB)}


class FakeDB:
    is_connected = True
    schema_ready = True

    def check_schema(self):
        return True

    def owns_session(self, session_id, user_id):
        return (session_id, user_id) in OWNED


class FakeTable:
    """Just enough of the supabase query builder for utils/feedback.py."""

    def __init__(self, store):
        self.store = store
        self.op = None
        self.filters = {}

    def upsert(self, row, on_conflict=None):
        self.op, self.row, self.on_conflict = "upsert", row, on_conflict
        return self

    def delete(self):
        self.op = "delete"
        return self

    def select(self, cols):
        self.op, self.cols = "select", cols
        return self

    def eq(self, col, value):
        self.filters[col] = value
        return self

    def execute(self):
        if self.store.broken:
            raise RuntimeError("database down")
        rows = self.store.rows
        if self.op == "upsert":
            assert self.on_conflict == "user_id,message_id"
            key = (self.row["user_id"], self.row["message_id"])
            rows[:] = [r for r in rows if (r["user_id"], r["message_id"]) != key] + [dict(self.row)]
            return NS(data=[self.row])
        matches = [r for r in rows if all(r.get(k) == v for k, v in self.filters.items())]
        if self.op == "delete":
            rows[:] = [r for r in rows if r not in matches]
        if self.op == "select":
            cols = self.cols.split(",")
            matches = [{c: r[c] for c in cols} for r in matches]
        return NS(data=matches)


class FakeAdminClient:
    def __init__(self):
        self.rows = []
        self.broken = False

    def table(self, name):
        assert name == "answer_feedback"
        return FakeTable(self)


admin = FakeAdminClient()
main._db_for = lambda user: FakeDB()
main.get_admin_client = lambda: admin
client = TestClient(main.app, raise_server_exceptions=False)


def as_user(uid):
    main.app.dependency_overrides[main.get_current_user] = \
        lambda: main.AuthedUser(id=uid, token="stub-token")


def vote(rating, session=ALICE_SESSION, message=ANSWER, **extra):
    return client.put("/api/feedback", json={"session_id": session, "message_id": message,
                                             "rating": rating, **extra})


print("\n[1] Auth and validation")

r = client.put("/api/feedback", json={"session_id": ALICE_SESSION, "message_id": ANSWER, "rating": "up"})
check("no token -> 401", r.status_code == 401, str(r.status_code))
r = client.get(f"/api/feedback?session_id={ALICE_SESSION}")
check("GET, no token -> 401", r.status_code == 401, str(r.status_code))

as_user(ALICE)
for label, body in [
    ("non-UUID session id", {"session_id": "abc", "message_id": ANSWER, "rating": "up"}),
    ("non-UUID message id", {"session_id": ALICE_SESSION, "message_id": "2", "rating": "up"}),
    ("unknown rating", {"session_id": ALICE_SESSION, "message_id": ANSWER, "rating": "meh"}),
]:
    r = client.put("/api/feedback", json=body)
    check(f"{label} -> 422", r.status_code == 422, str(r.status_code))
check("  ...and nothing stored", admin.rows == [])


print("\n[2] Voting on your own answers")

r = vote("up")
check("thumbs up -> 200", r.status_code == 200 and r.json() == {"success": True, "rating": "up"}, r.text)
check("one row stored", len(admin.rows) == 1 and admin.rows[0]["rating"] == "up", str(admin.rows))
row = admin.rows[0]
check("row holds ids, rating and flags only",
      set(row) == {"user_id", "session_id", "message_id", "rating", "is_followup", "updated_at"}, str(row))
check("row is attributed to the caller", row["user_id"] == ALICE and row["session_id"] == ALICE_SESSION)

vote("down")
check("changing the vote overwrites it", len(admin.rows) == 1 and admin.rows[0]["rating"] == "down",
      str(admin.rows))

vote("up", message=OTHER_ANSWER, is_followup=True)
check("a second answer gets its own row, flagged as a follow-up",
      len(admin.rows) == 2 and admin.rows[-1]["is_followup"] is True, str(admin.rows))

r = client.get(f"/api/feedback?session_id={ALICE_SESSION}")
check("GET returns this session's votes by message id",
      r.status_code == 200 and r.json() == {"ratings": {ANSWER: "down", OTHER_ANSWER: "up"}}, r.text)

r = vote(None)
check("null rating clears the vote", r.status_code == 200 and [x["message_id"] for x in admin.rows] == [OTHER_ANSWER],
      str(admin.rows))


print("\n[3] Other people's sessions")

r = vote("up", session=BOB_SESSION)
check("voting in someone else's session -> 404", r.status_code == 404, str(r.status_code))
r = client.get(f"/api/feedback?session_id={BOB_SESSION}")
check("reading someone else's votes -> 404", r.status_code == 404, str(r.status_code))
check("  ...and nothing stored for Bob's session", all(x["session_id"] != BOB_SESSION for x in admin.rows))

as_user(BOB)
vote("down", session=BOB_SESSION, message=ANSWER)
r = client.get(f"/api/feedback?session_id={BOB_SESSION}")
check("Bob sees only his own vote", r.json() == {"ratings": {ANSWER: "down"}}, r.text)
as_user(ALICE)
r = client.get(f"/api/feedback?session_id={ALICE_SESSION}")
check("Alice's votes are unaffected by Bob's", r.json() == {"ratings": {OTHER_ANSWER: "up"}}, r.text)


print("\n[4] Failures")

main.get_admin_client = lambda: None
r = vote("up")
check("no service-role client -> 503", r.status_code == 503, str(r.status_code))
main.get_admin_client = lambda: admin

admin.broken = True
r = vote("up")
check("database error -> 500 without details", r.status_code == 500 and "down" not in r.text, r.text)
r = client.get(f"/api/feedback?session_id={ALICE_SESSION}")
check("GET database error -> 500", r.status_code == 500, str(r.status_code))
admin.broken = False


print("\n[5] Migration")

path = os.path.join(os.path.dirname(__file__), "..", "..", "supabase", "migrations", "0009_answer_feedback.sql")
with open(path) as f:
    sql = re.sub(r"--[^\n]*", "", f.read()).lower()
check("RLS enabled", "alter table public.answer_feedback enable row level security" in sql)
check("anon and authenticated lose every privilege",
      "revoke all on public.answer_feedback from anon, authenticated" in sql)
check("no policies", "create policy" not in sql)
check("no grants to anon, authenticated or public",
      not re.search(r"grant[^;]*to[^;]*\b(anon|authenticated|public)\b", sql))
check("one vote per user per answer", "unique (user_id, message_id)" in sql)
check("no text columns besides the rating enum",
      re.findall(r"^\s+(\w+)\s+text\b", sql, re.M) == ["rating"], str(re.findall(r"^\s+(\w+)\s+text\b", sql, re.M)))


main.app.dependency_overrides.clear()

print()
if failures:
    print(f"{len(failures)} FAILED")
    sys.exit(1)
print("All feedback tests passed.")
