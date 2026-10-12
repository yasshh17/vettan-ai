"""
Timestamps the backend writes must carry a UTC offset. A bare datetime.now() is
local time, which Postgres reads as UTC.

    python tests/test_timestamps.py
"""
import os
import sys

for _k in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
    os.environ[_k] = ""
os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("TAVILY_API_KEY", "test")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timedelta  # noqa: E402
from types import SimpleNamespace as NS  # noqa: E402

import main  # noqa: E402
from database.supabase_client_v2 import VettanDatabaseV2  # noqa: E402

failures = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


def is_utc(value):
    try:
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return False
    return parsed.utcoffset() == timedelta(0)


ALICE = "11111111-1111-1111-1111-111111111111"
SESSION = "33333333-3333-3333-3333-333333333333"


class FakeQuery:
    def __init__(self, writes, table):
        self.writes, self.table, self.payload = writes, table, None

    def insert(self, payload):
        self.payload = payload
        self.writes.append((self.table, payload))
        return self

    def update(self, payload):
        self.payload = payload
        self.writes.append((self.table, payload))
        return self

    def select(self, *a, **k):
        return self

    def eq(self, *a):
        return self

    def order(self, *a, **k):
        return self

    def limit(self, *a):
        return self

    def execute(self):
        if isinstance(self.payload, list):
            return NS(data=self.payload)
        return NS(data=[self.payload or {"id": SESSION}])


class FakeClient:
    def __init__(self):
        self.writes = []

    def table(self, name):
        return FakeQuery(self.writes, name)


def fake_db():
    db = VettanDatabaseV2.__new__(VettanDatabaseV2)
    db.client = FakeClient()
    db.is_connected = True
    db.schema_ready = True
    return db


def timestamps(writes):
    found = []
    for table, payload in writes:
        for row in payload if isinstance(payload, list) else [payload]:
            found += [(table, key, row[key]) for key in ("created_at", "updated_at") if key in row]
    return found


print("\n[1] main._now_iso (message times sent to the client and saved)")
value = main._now_iso()
check(f"_now_iso() is UTC with an offset ({value})", is_utc(value))

print("\n[2] Database writes")
cases = {
    "save_session": lambda db: db.save_session("q", "r" * 200, [], {}, ALICE),
    "add_message": lambda db: db.add_message(SESSION, "user", "hi", ALICE),
    "add_messages_batch": lambda db: db.add_messages_batch(SESSION, [{"role": "user", "content": "hi"}], ALICE),
    "update_session": lambda db: db.update_session(SESSION, {"query": "renamed"}, ALICE),
}
for name, call in cases.items():
    db = fake_db()
    call(db)
    stamps = timestamps(db.client.writes)
    bad = [s for s in stamps if not is_utc(s[2])]
    check(f"{name}: {len(stamps)} timestamp(s), all UTC", stamps and not bad, str(bad or db.client.writes))

db = fake_db()
db.save_session("q", "r" * 200, [], {}, ALICE)
messages = [row for table, payload in db.client.writes if table == "messages" for row in payload]
check("save_session still orders the assistant message after the user message",
      len(messages) == 2 and messages[0]["created_at"] < messages[1]["created_at"], str(messages))

print()
if failures:
    print(f"{len(failures)} FAILED")
    sys.exit(1)
print("All timestamp tests passed.")
