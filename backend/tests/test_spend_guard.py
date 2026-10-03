"""
Spend guard tests. No network needed:

    python tests/test_spend_guard.py
"""
import os
import sys

# Set before importing main (see test_rate_limit.py).
for _k in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
    os.environ[_k] = ""
os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("TAVILY_API_KEY", "test")
# Keep the token buckets out of the way.
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["SPEND_GUARD_ENABLED"] = "true"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio  # noqa: E402
import logging  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402

from fastapi import HTTPException  # noqa: E402

from utils import spend_guard  # noqa: E402
from utils.spend_guard import (  # noqa: E402
    InMemorySpendStore,
    PostgresSpendStore,
    SpendGuardUnavailable,
)

failures = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


def run(coro):
    return asyncio.run(coro)


ALICE = "11111111-1111-1111-1111-111111111111"
BOB = "22222222-2222-2222-2222-222222222222"


print("\n[1] Helpers")

check("to_micros(0.035) == 35000", spend_guard.to_micros(0.035) == 35_000)
check("to_micros never returns 0 (the ledger rejects free charges)", spend_guard.to_micros(0.0) == 1)

noon = datetime(2026, 10, 3, 12, 0, 0, tzinfo=timezone.utc)
check("12:00 UTC -> 12h to midnight", spend_guard.seconds_until_utc_midnight(noon) == 12 * 3600)
last_second = datetime(2026, 10, 3, 23, 59, 59, 999999, tzinfo=timezone.utc)
check("one microsecond before midnight -> still >= 1 (a valid Retry-After)",
      spend_guard.seconds_until_utc_midnight(last_second) >= 1)

check("format_wait: hours and minutes", spend_guard.format_wait(5 * 3600 + 12 * 60 + 30) == "5h 12m")
check("format_wait: minutes only", spend_guard.format_wait(12 * 60) == "12m")
check("format_wait: under a minute", spend_guard.format_wait(30) == "under a minute")

check("audio cost scales with characters",
      abs(spend_guard.audio_cost_usd(1_000_000) - spend_guard.COST_AUDIO_PER_1M_CHARS_USD) < 1e-9)


print("\n[2] Store verdicts")


class FakeClock:
    def __init__(self, start):
        self.now = start

    def __call__(self):
        return self.now


clock = FakeClock(noon)
store = InMemorySpendStore(clock=clock)
USER_LIMIT, GLOBAL_LIMIT = 100, 250

d1 = run(store.reserve(ALICE, "research", 40, USER_LIMIT, GLOBAL_LIMIT))
d2 = run(store.reserve(ALICE, "research", 40, USER_LIMIT, GLOBAL_LIMIT))
d3 = run(store.reserve(ALICE, "research", 40, USER_LIMIT, GLOBAL_LIMIT))
check("charges under the user limit are allowed", d1.allowed and d2.allowed)
check("the charge that would cross the user limit is denied as 'user'",
      not d3.allowed and d3.reason == "user", str(d3))
check("a denied charge costs nothing", store.user_spent(ALICE) == 80, str(store.user_spent(ALICE)))
check("an exact fit is allowed (limit is inclusive)",
      run(store.reserve(ALICE, "followup", 20, USER_LIMIT, GLOBAL_LIMIT)).allowed)

check("another user's budget is independent",
      run(store.reserve(BOB, "research", 100, USER_LIMIT, GLOBAL_LIMIT)).allowed)

# Global is now 200 of 250.
d = run(store.reserve("33333333-3333-3333-3333-333333333333", "research", 60, USER_LIMIT, GLOBAL_LIMIT))
check("the charge that would cross the global limit is denied as 'global'",
      not d.allowed and d.reason == "global", str(d))

d = run(store.reserve(ALICE, "research", 60, USER_LIMIT, GLOBAL_LIMIT))
check("when both limits would be crossed, 'user' wins (the more accurate message)",
      not d.allowed and d.reason == "user", str(d))

run(store.refund(ALICE, "research", 40))
check("refund gives the budget back", store.user_spent(ALICE) == 60, str(store.user_spent(ALICE)))
run(store.refund(ALICE, "research", 10_000))
check("refund is floored at zero", store.user_spent(ALICE) == 0 and store.global_spent() >= 0)

clock.now = noon + timedelta(days=1)
check("a new UTC day starts every budget at zero",
      store.user_spent(BOB) == 0 and store.global_spent() == 0)
check("  and BOB can spend his full budget again",
      run(store.reserve(BOB, "research", 100, USER_LIMIT, GLOBAL_LIMIT)).allowed)


print("\n[3] charge()")


def charge_raises(store_, user, kind, usd, units=1):
    try:
        run(spend_guard.charge(store_, user, kind, usd, units))
    except HTTPException as e:
        return e
    return None


spend_guard.USER_DAILY_BUDGET_USD = 0.10
spend_guard.GLOBAL_DAILY_BUDGET_USD = 1.00
s = InMemorySpendStore()

reservation = run(spend_guard.charge(s, ALICE, "research", 0.06))
check("an allowed charge returns a Reservation for refunding",
      reservation is not None and reservation.cost_micros == 60_000)

e = charge_raises(s, ALICE, "research", 0.06)
check("over the user budget -> 429", e is not None and e.status_code == 429, str(e))
check("  with a Retry-After header", e is not None and int(e.headers["Retry-After"]) >= 1)
check("  marked X-Spend-Limit: user, so the frontend can tell it apart",
      e is not None and e.headers.get("X-Spend-Limit") == "user")
check("  and a human-readable reset time",
      e is not None and "today's usage limit" in e.detail and "resets in" in e.detail,
      e.detail if e else "")

run(spend_guard.refund(s, reservation))
check("refund(reservation) restores the budget", s.user_spent(ALICE) == 0)
run(spend_guard.refund(s, None))
check("refund(None) is a no-op (guard disabled)", True)

spend_guard.GLOBAL_DAILY_BUDGET_USD = 0.05
e = charge_raises(InMemorySpendStore(), BOB, "research", 0.06)
check("over the global budget -> 503 with Retry-After",
      e is not None and e.status_code == 503 and "Retry-After" in e.headers, str(e))
check("  with the capacity message", e is not None and "capacity" in e.detail)
check("  marked X-Spend-Limit: global", e is not None and e.headers.get("X-Spend-Limit") == "global")
spend_guard.GLOBAL_DAILY_BUDGET_USD = 1.00


class BrokenStore:
    async def reserve(self, *a, **k):
        raise SpendGuardUnavailable("db down")

    async def refund(self, *a, **k):
        raise SpendGuardUnavailable("db down")


e = charge_raises(BrokenStore(), ALICE, "audio", 0.01)
check("an unreachable ledger fails CLOSED -> 503", e is not None and e.status_code == 503, str(e))
check("  marked X-Spend-Limit: unavailable",
      e is not None and (e.headers or {}).get("X-Spend-Limit") == "unavailable")
check("  naming the feature", e is not None and e.detail.startswith("Audio"), e.detail if e else "")
run(spend_guard.refund(BrokenStore(), spend_guard.Reservation(ALICE, "research", 1, 1)))
check("a failed refund never raises", True)

spend_guard.ENABLED = False
check("disabled guard charges nothing and returns None",
      run(spend_guard.charge(BrokenStore(), ALICE, "research", 0.06)) is None)
spend_guard.ENABLED = True


class Capture(logging.Handler):
    def __init__(self):
        super().__init__()
        self.records = []

    def emit(self, record):
        self.records.append(record)


cap = Capture()
spend_guard.logger.addHandler(cap)
spend_guard._alerted_day = None
s = InMemorySpendStore()
spend_guard.USER_DAILY_BUDGET_USD = 1.00
for _ in range(3):
    run(spend_guard.charge(s, ALICE, "research", 0.30))  # 0.30, 0.60, 0.90 of 1.00
alarms = [r for r in cap.records if "daily budget" in r.getMessage() and r.levelno == logging.ERROR]
check("crossing 80% of the global budget logs an ERROR", len(alarms) == 1, str(len(alarms)))
spend_guard.logger.removeHandler(cap)


print("\n[4] Postgres store")


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeRPC:
    def __init__(self, client, name, params):
        self.client, self.name, self.params = client, name, params

    def execute(self):
        self.client.calls.append((self.name, self.params))
        if self.client.error:
            raise self.client.error
        return FakeResponse(self.client.data)


class FakeClient:
    def __init__(self, data=None, error=None):
        self.data, self.error, self.calls = data, error, []

    def rpc(self, name, params):
        return FakeRPC(self, name, params)


fc = FakeClient(data=[{"allowed": True, "reason": None, "user_spent": 35000, "global_spent": 90000}])
d = run(PostgresSpendStore(lambda: fc).reserve(ALICE, "research", 35000, 1_000_000, 25_000_000, 1))
check("reserve parses the RPC row", d.allowed and d.user_spent_micros == 35000 and d.global_spent_micros == 90000)
check("reserve sends every parameter the SQL function takes",
      fc.calls[0] == ("reserve_spend", {
          "p_user": ALICE, "p_kind": "research", "p_cost": 35000,
          "p_user_limit": 1_000_000, "p_global_limit": 25_000_000, "p_units": 1,
      }), str(fc.calls[0]))

fc = FakeClient(data=[{"allowed": False, "reason": "user", "user_spent": 990000, "global_spent": 1}])
d = run(PostgresSpendStore(lambda: fc).reserve(ALICE, "research", 35000, 1_000_000, 25_000_000))
check("a denial row keeps its reason", not d.allowed and d.reason == "user")


def raises_unavailable(coro):
    try:
        run(coro)
    except SpendGuardUnavailable:
        return True
    return False


check("no service-role client -> SpendGuardUnavailable",
      raises_unavailable(PostgresSpendStore(lambda: None).reserve(ALICE, "research", 1, 2, 3)))
check("an RPC error (e.g. migration not applied) -> SpendGuardUnavailable",
      raises_unavailable(PostgresSpendStore(lambda: FakeClient(error=RuntimeError("42883")))
                         .reserve(ALICE, "research", 1, 2, 3)))
check("an empty result -> SpendGuardUnavailable, never 'allowed'",
      raises_unavailable(PostgresSpendStore(lambda: FakeClient(data=[])).reserve(ALICE, "research", 1, 2, 3)))

fc = FakeClient(data=None)
run(PostgresSpendStore(lambda: fc).refund(ALICE, "audio", 500, 120))
check("refund calls refund_spend",
      fc.calls[0] == ("refund_spend", {"p_user": ALICE, "p_kind": "audio", "p_cost": 500, "p_units": 120}))


print("\n[5] Endpoints")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

client = TestClient(main.app, raise_server_exceptions=False)


class FakeDB:
    is_connected = True
    schema_ready = True
    cached = None
    history = []

    def check_schema(self):
        return True

    def check_cache(self, query, user_id):
        return FakeDB.cached

    def get_conversation_history(self, session_id, user_id):
        return FakeDB.history


CACHED_ROW = {"id": "cached-session", "user_id": ALICE, "report": "cached answer " * 20, "citations": []}


async def _fake_research(query, *args, **kwargs):
    return {"output": "stub answer " * 20, "citations": [], "metadata": {}}


async def _fake_research_stream(query, *args, **kwargs):
    yield {"type": "token", "text": "stub"}
    yield {"type": "final", "output": "stub answer " * 20, "citations": [], "metadata": {}}


main.research_complete = _fake_research
main.research_stream = _fake_research_stream
main._persist_new_session = lambda *a, **k: None
main._persist_followup = lambda *a, **k: None
main._db_for = lambda user: FakeDB()
main.app.dependency_overrides[main.get_current_user] = \
    lambda: main.AuthedUser(id=ALICE, token="stub-token")

# Two new research requests fit; the third doesn't.
spend_guard.USER_DAILY_BUDGET_USD = 0.08
spend_guard.GLOBAL_DAILY_BUDGET_USD = 100.0
spend_guard.COST_RESEARCH_USD = 0.035


def fresh_store():
    main._spend_store = InMemorySpendStore()
    FakeDB.cached = None
    FakeDB.history = []
    return main._spend_store


s = fresh_store()
codes = [client.post("/api/research", json={"query": f"q{i}"}).status_code for i in range(2)]
r = client.post("/api/research", json={"query": "q3"})
check(f"/api/research: two fit, the third is 429 -> {codes + [r.status_code]}",
      codes == [200, 200] and r.status_code == 429)
check("  the 429 carries the daily-limit message and Retry-After",
      "today's usage limit" in r.json().get("detail", "") and "retry-after" in r.headers, r.text[:120])
check("  and the rejected request released its slot", main._research_slots.in_flight() == 0)

r = client.post("/api/research", json={"query": "q4"}, headers={"Origin": "http://localhost:3000"})
exposed = r.headers.get("access-control-expose-headers", "").lower()
check("CORS exposes Retry-After and X-Spend-Limit to the browser",
      "retry-after" in exposed and "x-spend-limit" in exposed, exposed)

s = fresh_store()
FakeDB.cached = CACHED_ROW
r = client.post("/api/research", json={"query": "cached"})
check(f"/api/research: a cache hit is free -> {r.status_code}, spent={s.user_spent(ALICE)}",
      r.status_code == 200 and s.user_spent(ALICE) == 0)

s = fresh_store()
r = client.post("/api/research/stream", json={"query": "fresh"})
check(f"/stream: a new research is charged -> {r.status_code}, spent={s.user_spent(ALICE)}",
      r.status_code == 200 and s.user_spent(ALICE) == 35_000)

s = fresh_store()
FakeDB.cached = CACHED_ROW
r = client.post("/api/research/stream", json={"query": "cached"})
check(f"/stream: a cache hit is refunded -> spent={s.user_spent(ALICE)}",
      r.status_code == 200 and "cached answer" in r.text and s.user_spent(ALICE) == 0)

s = fresh_store()
FakeDB.history = []
r = client.post("/api/research/stream",
                json={"query": "follow", "session_id": "not-mine", "is_followup": True})
check(f"/stream: a follow-up to a missing conversation is refunded -> spent={s.user_spent(ALICE)}",
      "Conversation not found" in r.text and s.user_spent(ALICE) == 0)

s = fresh_store()
client.post("/api/research/stream", json={"query": "a"})
client.post("/api/research/stream", json={"query": "b"})
rejected = [client.post("/api/research/stream", json={"query": "c"}).status_code for _ in range(3)]
check(f"/stream: over budget is a real HTTP 429, not an SSE error -> {rejected}",
      rejected == [429, 429, 429])
check(f"REGRESSION: rejected streams release their slots -> in_flight={main._research_slots.in_flight()}",
      main._research_slots.in_flight() == 0)

fresh_store()
spend_guard.GLOBAL_DAILY_BUDGET_USD = 0.01
r = client.post("/api/research/stream", json={"query": "x"})
check(f"/stream: global budget reached -> 503 -> {r.status_code}",
      r.status_code == 503 and "capacity" in r.json().get("detail", ""))
spend_guard.GLOBAL_DAILY_BUDGET_USD = 100.0

main._spend_store = PostgresSpendStore(lambda: None)
r1 = client.post("/api/research", json={"query": "x"})
r2 = client.post("/api/research/stream", json={"query": "x"})
check(f"no service-role key: research fails closed -> {r1.status_code}, {r2.status_code}",
      r1.status_code == 503 and r2.status_code == 503)
check("  and the stream's slot is still released", main._research_slots.in_flight() == 0)


class FakeTTS:
    def prepare_text_for_speech(self, text):
        return text

    def generate_audio(self, text, voice):
        return b"mp3"

    def estimate_cost(self, text):
        return 0.0


main.get_tts = lambda: FakeTTS()
s = fresh_store()
spend_guard.USER_DAILY_BUDGET_USD = 0.001  # 66 chars at $15 / 1M chars
r_ok = client.post("/api/audio", json={"text": "a" * 50})
r_no = client.post("/api/audio", json={"text": "a" * 50})
check(f"/api/audio: charged per character, over budget is 429 -> {r_ok.status_code}, {r_no.status_code}",
      r_ok.status_code == 200 and r_no.status_code == 429)

main.app.dependency_overrides.clear()


print("\n" + "=" * 60)
if failures:
    print(f"FAILED ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("All spend guard checks passed.")
