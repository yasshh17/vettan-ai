"""
Moderation tests. No network needed: the OpenAI call is replaced with a fake.

    python tests/test_moderation.py
"""
import os
import sys

# Set before importing main (see test_rate_limit.py).
for _k in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
    os.environ[_k] = ""
os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("TAVILY_API_KEY", "test")
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["MODERATION_ENABLED"] = "true"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio  # noqa: E402
import json  # noqa: E402

from utils import moderation, spend_guard  # noqa: E402
from utils.moderation import Verdict  # noqa: E402
from utils.spend_guard import InMemorySpendStore  # noqa: E402

failures = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


def run(coro):
    return asyncio.run(coro)


ALICE = "11111111-1111-1111-1111-111111111111"
BAD = "BAD"  # any text containing this is flagged by the fake

moderated = []


async def _fake_moderate(text):
    moderated.append(text)
    if BAD in text:
        return Verdict(True, ["violence"])
    if "HURT" in text:
        return Verdict(True, ["self-harm", "self-harm/intent"])
    return Verdict(False)


async def _down(text):
    raise RuntimeError("moderation API down")


async def _slow(text):
    await asyncio.sleep(1)
    return Verdict(False)


moderation._moderate = _fake_moderate


print("\n[1] check()")

check("clean text passes", run(moderation.check("hello", "input")) == Verdict(False))
v = run(moderation.check(f"{BAD} query", "input"))
check("flagged text is flagged, with categories", v.flagged and v.categories == ["violence"])

moderated.clear()
check("blank text skips the call", run(moderation.check("   ", "input")) == Verdict(False) and not moderated)

moderation.ENABLED = False
moderated.clear()
check("MODERATION_ENABLED=false skips the call",
      not run(moderation.check(BAD, "input")).flagged and not moderated)
moderation.ENABLED = True

moderation._moderate = _down
check("API error fails open by default", not run(moderation.check("x", "input")).flagged)
moderation.FAIL_CLOSED = True
v = run(moderation.check("x", "input"))
check("API error with MODERATION_FAIL_CLOSED=true is flagged unavailable", v.flagged and v.unavailable)
moderation.FAIL_CLOSED = False

moderation._moderate = _slow
moderation.TIMEOUT_S = 0.05
check("timeout fails open", not run(moderation.check("x", "input")).flagged)
moderation.TIMEOUT_S = 3.0
moderation._moderate = _fake_moderate


print("\n[2] blocked() / message()")

e = moderation.blocked("input", Verdict(True, ["violence"]))
check("flagged input -> 400 with the marker header",
      e.status_code == 400 and e.headers == {moderation.MARKER_HEADER: "input"})
e = moderation.blocked("input", Verdict(True, unavailable=True))
check("unavailable -> 503 marked unavailable",
      e.status_code == 503 and e.headers == {moderation.MARKER_HEADER: "unavailable"})
check("self-harm input gets the helpline message",
      "findahelpline.com" in moderation.message("input", Verdict(True, ["self-harm"])))
check("self-harm in an answer gets the generic message",
      "findahelpline.com" not in moderation.message("output", Verdict(True, ["self-harm"])))


print("\n[3] Endpoints")

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

client = TestClient(main.app, raise_server_exceptions=False)


class FakeDB:
    is_connected = True
    schema_ready = True
    history = []

    def check_schema(self):
        return True

    def check_cache(self, query, user_id):
        return None

    def get_conversation_history(self, session_id, user_id):
        return FakeDB.history


calls = {"research": 0, "persisted": 0, "tts": 0}
answer = {"text": "stub answer " * 20}


async def _fake_research(query, *args, **kwargs):
    calls["research"] += 1
    return {"output": answer["text"], "citations": [], "metadata": {}}


async def _fake_research_stream(query, *args, **kwargs):
    calls["research"] += 1
    yield {"type": "token", "text": "stub"}
    yield {"type": "final", "output": answer["text"], "citations": [], "metadata": {}}


async def _fake_followup_stream(query, conversation_history):
    calls["research"] += 1
    yield {"type": "token", "text": "stub"}
    yield {"type": "final", "output": answer["text"], "citations": [], "metadata": {}}


def _persist(*a, **k):
    calls["persisted"] += 1


class FakeTTS:
    def prepare_text_for_speech(self, text):
        return text

    def generate_audio(self, text, voice):
        calls["tts"] += 1
        return b"mp3"

    def estimate_cost(self, text):
        return 0.0


main.research_complete = _fake_research
main.research_stream = _fake_research_stream
main.handle_followup_stream = _fake_followup_stream
main._persist_new_session = _persist
main._persist_followup = _persist
main._db_for = lambda user: FakeDB()
main.get_tts = lambda: FakeTTS()
main.app.dependency_overrides[main.get_current_user] = \
    lambda: main.AuthedUser(id=ALICE, token="stub-token")
spend_guard.USER_DAILY_BUDGET_USD = 100.0
spend_guard.GLOBAL_DAILY_BUDGET_USD = 100.0


def reset():
    main._spend_store = InMemorySpendStore()
    for k in calls:
        calls[k] = 0
    answer["text"] = "stub answer " * 20
    FakeDB.history = []
    return main._spend_store


def events(body):
    return [frame.split("\n", 1)[0].removeprefix("event: ") for frame in body.strip().split("\n\n")]


def blocked_message(body):
    for frame in body.strip().split("\n\n"):
        if frame.startswith("event: blocked"):
            return json.loads(frame.split("data: ", 1)[1])["message"]
    return None


store = reset()
r = client.post("/api/research/stream", json={"query": f"{BAD} query"},
                headers={"Origin": "http://localhost:3000"})
check(f"stream: flagged query -> 400 marked input -> {r.status_code}",
      r.status_code == 400 and r.headers.get(moderation.MARKER_HEADER) == "input")
check("  the marker header is readable cross-origin",
      moderation.MARKER_HEADER in r.headers.get("access-control-expose-headers", ""))
check("  no research ran", calls["research"] == 0)
check("  nothing charged", store.user_spent(ALICE) == 0)
check("  slot released", main._research_slots.in_flight() == 0)

store = reset()
r = client.post("/api/research/stream", json={"query": "HURT"})
check("stream: self-harm query gets the helpline message", "findahelpline.com" in r.json()["detail"])

store = reset()
r = client.post("/api/research/stream", json={"query": "fine query"})
check(f"stream: clean query streams to done -> {events(r.text)}",
      r.status_code == 200 and events(r.text)[-1] == "done" and calls["persisted"] == 1)

store = reset()
answer["text"] = f"{BAD} answer " * 20
r = client.post("/api/research/stream", json={"query": "fine query"})
check(f"stream: flagged answer ends with blocked, no done -> {events(r.text)}",
      events(r.text)[-1] == "blocked" and "done" not in events(r.text))
check("  with the withheld message", "withheld" in (blocked_message(r.text) or ""))
check("  not saved", calls["persisted"] == 0)
check("  still charged (the work ran)", store.user_spent(ALICE) > 0)
check("  slot released", main._research_slots.in_flight() == 0)

store = reset()
FakeDB.history = [{"id": "m1", "role": "user", "content": "earlier", "created_at": "x"}]
answer["text"] = f"{BAD} answer"
r = client.post("/api/research/stream",
                json={"query": "fine follow-up", "session_id": "s1", "is_followup": True})
check(f"stream follow-up: flagged answer ends with blocked -> {events(r.text)}",
      events(r.text)[-1] == "blocked" and calls["persisted"] == 0)

store = reset()
FakeDB.history = [{"id": "m1", "role": "user", "content": "earlier", "created_at": "x"}]
r = client.post("/api/research/stream",
                json={"query": f"{BAD} follow-up", "session_id": "s1", "is_followup": True})
check(f"stream follow-up: flagged query -> 400 -> {r.status_code}",
      r.status_code == 400 and calls["research"] == 0 and store.user_spent(ALICE) == 0)

store = reset()
r = client.post("/api/research", json={"query": f"{BAD} query"})
check(f"/api/research: flagged query -> 400 marked input -> {r.status_code}",
      r.status_code == 400 and r.headers.get(moderation.MARKER_HEADER) == "input"
      and calls["research"] == 0 and store.user_spent(ALICE) == 0)
check("  slot released", main._research_slots.in_flight() == 0)

store = reset()
answer["text"] = f"{BAD} answer " * 20
r = client.post("/api/research", json={"query": "fine query"})
check(f"/api/research: flagged answer -> 400 marked output -> {r.status_code}",
      r.status_code == 400 and r.headers.get(moderation.MARKER_HEADER) == "output"
      and calls["persisted"] == 0)

store = reset()
r = client.post("/api/research", json={"query": "fine query"})
check(f"/api/research: clean query -> 200 -> {r.status_code}", r.status_code == 200)

store = reset()
r = client.post("/api/audio", json={"text": f"{BAD} text"})
check(f"/api/audio: flagged text -> 400 marked audio, no TTS, no charge -> {r.status_code}",
      r.status_code == 400 and r.headers.get(moderation.MARKER_HEADER) == "audio"
      and calls["tts"] == 0 and store.user_spent(ALICE) == 0)

store = reset()
r = client.post("/api/audio", json={"text": "fine text"})
check(f"/api/audio: clean text -> 200 -> {r.status_code}", r.status_code == 200 and calls["tts"] == 1)

store = reset()
moderation._moderate = _down
moderation.FAIL_CLOSED = True
r = client.post("/api/research/stream", json={"query": "fine query"})
check(f"fail closed: stream -> 503 marked unavailable -> {r.status_code}",
      r.status_code == 503 and r.headers.get(moderation.MARKER_HEADER) == "unavailable"
      and calls["research"] == 0)
moderation.FAIL_CLOSED = False
r = client.post("/api/research/stream", json={"query": "fine query"})
check(f"fail open: stream still answers -> {events(r.text)}", events(r.text)[-1] == "done")
moderation._moderate = _fake_moderate

main.app.dependency_overrides.clear()


print("\n" + "=" * 60)
if failures:
    print(f"FAILED ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("All moderation checks passed.")
