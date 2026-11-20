"""
Product usage events: the allowlist, POST /api/events and the server-side hooks.
Runs offline: the RPC is faked here and runs on a real Postgres in test_analytics_sql.py.

    python tests/test_product_events.py
"""
import logging
import os
import re
import sys

for _k in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ANALYTICS_ADMIN_USER_IDS"):
    os.environ[_k] = ""
os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("TAVILY_API_KEY", "test")
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["SPEND_GUARD_ENABLED"] = "false"
os.environ["MODERATION_ENABLED"] = "false"
os.environ["ANALYTICS_ENABLED"] = "true"
os.environ["ANALYTICS_ID_SECRET"] = "product-events-test-secret-" + "x" * 20

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from types import SimpleNamespace as NS  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from utils import analytics, analytics_keys, product_events  # noqa: E402

failures = []
log_lines = []


class LogCapture(logging.Handler):
    def emit(self, record):
        log_lines.append(record.getMessage())


logging.getLogger().addHandler(LogCapture())


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + str(detail) if detail and not cond else ''}")
    if not cond:
        failures.append(label)


ALICE = "11111111-1111-1111-1111-111111111111"
SESSION = "33333333-3333-3333-3333-333333333333"
VISIT = "6f1c2a9e-4b7d-4c1e-9a53-0d2b8e7f1a44"
SECRET = "SECRETTEXT-9c1d"


class FakeRpc:
    """record_product_events: rows written, or 0 when consent is off."""

    def __init__(self, granted=True, fail=False):
        self.calls = []
        self.granted = granted
        self.fail = fail

    def rpc(self, name, params):
        self.calls.append((name, params))
        if self.fail:
            raise RuntimeError(f"database is down; payload was {params}")
        written = len(params["p_events"]) if self.granted else 0
        return NS(execute=lambda: NS(data=written))


def use_rpc(**kw):
    analytics.flush()
    rpc = FakeRpc(**kw)
    product_events.store = product_events.SupabaseProductEventStore(lambda: rpc)
    return rpc


def events_of(rpc):
    check("analytics writes drained", analytics.flush(5))
    return [e for _, params in rpc.calls for e in params["p_events"]]


# ---------------------------------------------------------------------------
print("\n[1] Only listed events and props get through")

build = product_events.build_event
check("unknown event is dropped", build("clicked_everything", {}, VISIT) is None)
check("a listed browser event is kept",
      build("page_viewed", {"route": "app"}, VISIT) == {"event": "page_viewed", "props": {"route": "app"}, "visit_id": VISIT})
check("a value outside the fixed choices is dropped",
      build("page_viewed", {"route": SECRET}, VISIT)["props"] == {})
check("an unknown prop is dropped",
      build("signed_in", {"email": SECRET, "query": SECRET}, VISIT)["props"] == {})
check("a count inside its range is kept", build("sources_expanded", {"count": 7}, VISIT)["props"] == {"count": 7})
check("a count out of range is dropped", build("sources_expanded", {"count": 51}, VISIT)["props"] == {})
check("a negative count is dropped", build("sources_expanded", {"count": -1}, VISIT)["props"] == {})
check("a bool is not a count", build("sources_expanded", {"count": True}, VISIT)["props"] == {})
check("a string is not a count", build("sources_expanded", {"count": "7"}, VISIT)["props"] == {})
check("a malformed visit_id rejects the event", build("signed_in", {}, "not-a-uuid") is None)
check("a visit_id with text appended is rejected", build("signed_in", {}, VISIT + SECRET) is None)
check("visit_id is normalised to lower case",
      build("signed_in", {}, VISIT.upper())["visit_id"] == VISIT)
check("no visit_id is allowed", build("signed_in", {}, None)["visit_id"] is None)
check("the browser can't send a server event", build("research_submitted", {"source": "typed"}, VISIT) is None)
check("the browser can't send chat_deleted", build("chat_deleted", {}, None) is None)

server = build("research_submitted", {"source": "voice", "is_followup": True}, VISIT, server=True)
check("a server event is kept with its props",
      server["event"] == "research_submitted" and server["props"] == {"source": "voice", "is_followup": True})
check("a server event never carries a visit_id", server["visit_id"] is None)
check("a server event can't be a browser event", build("page_viewed", {"route": "app"}, None, server=True) is None)
check("a non-bool flag is dropped",
      build("chat_favorited", {"favorite": "yes"}, None, server=True)["props"] == {})
check("props are never a non-dict", build("signed_in", [SECRET], VISIT)["props"] == {})

# The table CHECKs event ~ '^[a-z_]{1,40}$'; one bad name fails the whole batch.
names = list(product_events.SERVER_EVENTS) + list(product_events.BROWSER_EVENTS)
check("every listed name passes the table's CHECK", all(re.fullmatch(r"[a-z_]{1,40}", n) for n in names), names)
check("server and browser lists don't overlap",
      not set(product_events.SERVER_EVENTS) & set(product_events.BROWSER_EVENTS))


# ---------------------------------------------------------------------------
print("\n[2] Writes go through the consent RPC, linked by coded ID only")

rpc = use_rpc()
written = product_events.write(ALICE, [build("signed_in", {}, VISIT)])
name, params = rpc.calls[0]
check("writes through record_product_events", name == "record_product_events")
check("p_user is the account id", params["p_user"] == ALICE)
check("p_actor is the coded ID", params["p_actor"] == analytics_keys.actor_id(ALICE))
check("sends the key fingerprint", params["p_fingerprint"] == analytics_keys.fingerprint("id"))
check("events hold no account id", ALICE not in str(params["p_events"]))
check("returns rows written", written == 1)

rpc = use_rpc()
check("nothing to write: 0, no call", product_events.write(ALICE, []) == 0 and not rpc.calls)
check("Global Privacy Control: nothing stored",
      product_events.write(ALICE, [build("signed_in", {}, VISIT)], gpc=True) is None and not rpc.calls)

os.environ["ANALYTICS_ADMIN_USER_IDS"] = f" {ALICE.upper()} "
check("admins are never tracked", product_events.write(ALICE, [build("signed_in", {}, VISIT)]) is None
      and not rpc.calls)
os.environ["ANALYTICS_ADMIN_USER_IDS"] = ""

analytics.ENABLED = False
check("analytics off: nothing stored", product_events.write(ALICE, [build("signed_in", {}, VISIT)]) is None
      and not rpc.calls)
analytics.ENABLED = True

saved = os.environ.pop("ANALYTICS_ID_SECRET")
check("no ID secret: nothing stored, never the raw id",
      product_events.write(ALICE, [build("signed_in", {}, VISIT)]) is None and not rpc.calls)
os.environ["ANALYTICS_ID_SECRET"] = saved

product_events.store = product_events.SupabaseProductEventStore(lambda: None)
check("no admin client: nothing stored", product_events.write(ALICE, [build("signed_in", {}, VISIT)]) is None)


# ---------------------------------------------------------------------------
print("\n[3] POST /api/events")

client = TestClient(main.app, raise_server_exceptions=False)
main.app.dependency_overrides[main.get_current_user] = lambda: main.AuthedUser(id=ALICE, token="stub-token")

rpc = use_rpc()
r = client.post("/api/events", json={
    "actor_id": "f" * 32,
    "user_id": "22222222-2222-2222-2222-222222222222",
    "events": [
        {"event": "page_viewed", "props": {"route": "app"}, "visit_id": VISIT, "actor_id": "f" * 32},
        {"event": "citation_clicked", "props": {"url": SECRET}, "visit_id": VISIT},
        {"event": "made_up", "props": {}, "visit_id": VISIT},
        {"event": "research_submitted", "props": {"source": "typed"}, "visit_id": VISIT},
    ],
})
check("200 with stored count", r.status_code == 200 and r.json() == {"stored": 2, "stop": False}, r.text)
params = rpc.calls[0][1]
check("actor comes from the token, not the body",
      params["p_user"] == ALICE and params["p_actor"] == analytics_keys.actor_id(ALICE), params)
check("unknown and server-only events dropped",
      [e["event"] for e in params["p_events"]] == ["page_viewed", "citation_clicked"], params["p_events"])
check("no free text reaches the RPC", SECRET not in str(rpc.calls) and "f" * 32 not in str(rpc.calls))

rpc = use_rpc()
r = client.post("/api/events", json={"events": [{"event": "signed_in", "props": {}}] * 21})
check("more than 20 events: 422 and nothing stored", r.status_code == 422 and not rpc.calls, r.status_code)

r = client.post("/api/events", json={"events": [{"event": "signed_in", "props": {"x": SECRET * 10}}]})
check("a long prop value: 422 and nothing stored", r.status_code == 422 and not rpc.calls, r.status_code)

r = client.post("/api/events", json={"events": [{"event": "signed_in", "props": {"x": {"nested": SECRET}}}]})
check("a nested prop value: 422 and nothing stored", r.status_code == 422 and not rpc.calls, r.status_code)

r = client.post("/api/events", json={"events": [{"event": "page_viewed", "props": {"route": "app"}}]},
                headers={"Sec-GPC": "1"})
check("Sec-GPC: 1 stores nothing and tells the tracker to stop",
      r.status_code == 200 and r.json() == {"stored": 0, "stop": True} and not rpc.calls, r.text)

rpc = use_rpc(granted=False)
r = client.post("/api/events", json={"events": [{"event": "page_viewed", "props": {"route": "app"}}]})
check("no consent: stored 0 and stop", r.json() == {"stored": 0, "stop": True}, r.text)

rpc = use_rpc()
r = client.post("/api/events", json={"events": [{"event": "made_up", "props": {}}]})
check("nothing valid: no call, and no stop", r.json() == {"stored": 0, "stop": False} and not rpc.calls, r.text)

rpc = use_rpc(fail=True)
log_lines.clear()
r = client.post("/api/events", json={"events": [{"event": "page_viewed", "props": {"route": "app"}, "visit_id": VISIT}]})
check("database down: 200, stored 0, no stop", r.status_code == 200 and r.json() == {"stored": 0, "stop": False},
      r.text)
check("  ...and the log holds no payload", not any(VISIT in line or ALICE in line for line in log_lines), log_lines)

main.app.dependency_overrides.clear()
rpc = use_rpc()
r = client.post("/api/events", json={"events": [{"event": "signed_in", "props": {}}]})
check("signed out: 401 and nothing stored", r.status_code == 401 and not rpc.calls, r.status_code)
main.app.dependency_overrides[main.get_current_user] = lambda: main.AuthedUser(id=ALICE, token="stub-token")


# ---------------------------------------------------------------------------
print("\n[4] Server events from the API")

HISTORY = [
    {"id": "m1", "role": "user", "content": SECRET, "citations": [], "metadata": {}, "created_at": "x"},
    {"id": "m2", "role": "assistant", "content": SECRET, "citations": [], "metadata": {}, "created_at": "x"},
]


class FakeDB:
    is_connected = True
    schema_ready = True

    def check_schema(self):
        return True

    def check_cache(self, query, user_id):
        return None

    def get_conversation_history(self, session_id, user_id):
        return HISTORY

    def get_session_by_id(self, session_id, user_id):
        return {"id": session_id, "query": SECRET, "report": SECRET, "citations": [], "metadata": {}}

    def update_session(self, session_id, data, user_id):
        return True

    def delete_session(self, session_id, user_id):
        return True


async def _no_research(query):
    raise RuntimeError("pipeline not needed here")


async def _no_followup(query, conversation_history):
    raise RuntimeError("pipeline not needed here")


async def _empty_stream(*a, **k):
    return
    yield


main._db_for = lambda user: FakeDB()
main._persist_new_session = lambda *a, **k: None
main._persist_followup = lambda *a, **k: None
main.research_complete = _no_research
main.handle_followup = _no_followup
main.research_stream = _empty_stream
main.handle_followup_stream = _empty_stream


class FakeTTS:
    def prepare_text_for_speech(self, text):
        return text

    def generate_audio(self, text, voice):
        return b"audio"

    def estimate_cost(self, text):
        return 0.0


main.get_tts = lambda: FakeTTS()


def server_events(method, path, **kw):
    rpc = use_rpc()
    r = client.request(method, path, **kw)
    return r, [(e["event"], e["props"], e.get("visit_id")) for e in events_of(rpc)], rpc


r, got, _ = server_events("POST", "/api/research/stream", json={"query": SECRET})
check("stream research: research_submitted, typed by default",
      got == [("research_submitted", {"source": "typed", "is_followup": False}, None)], got)

r, got, _ = server_events("POST", "/api/research/stream",
                          json={"query": SECRET, "session_id": SESSION, "is_followup": True, "source": "suggested"})
check("stream follow-up: source and is_followup",
      got == [("research_submitted", {"source": "suggested", "is_followup": True}, None)], got)

r, got, _ = server_events("POST", "/api/research", json={"query": SECRET, "source": "voice"})
check("sync research: research_submitted from voice",
      got == [("research_submitted", {"source": "voice", "is_followup": False}, None)], got)

r, got, _ = server_events("POST", "/api/research",
                          json={"query": SECRET, "session_id": SESSION, "is_followup": True})
check("sync follow-up: research_submitted",
      got == [("research_submitted", {"source": "typed", "is_followup": True}, None)], got)

r = client.post("/api/research", json={"query": SECRET, "source": "pasted"})
check("an unknown source is a 422", r.status_code == 422, r.status_code)

r, got, rpc = server_events("POST", "/api/research/stream", json={"query": SECRET}, headers={"Sec-GPC": "1"})
check("Sec-GPC: 1 on research stores nothing", got == [] and not rpc.calls, got)

r, got, _ = server_events("POST", "/api/audio", json={"text": SECRET})
check("audio: audio_generated", r.status_code == 200 and got == [("audio_generated", {}, None)], (r.status_code, got))

r, got, _ = server_events("GET", f"/api/history/{SESSION}")
check("open a chat: chat_opened", r.status_code == 200 and got == [("chat_opened", {}, None)], (r.status_code, got))

r, got, _ = server_events("PATCH", f"/api/history/{SESSION}", json={"is_favorite": True})
check("favourite: chat_favorited", got == [("chat_favorited", {"favorite": True}, None)], got)

r, got, _ = server_events("PATCH", f"/api/history/{SESSION}", json={"isFavorite": False})
check("unfavourite: chat_favorited false", got == [("chat_favorited", {"favorite": False}, None)], got)

r, got, _ = server_events("PATCH", f"/api/history/{SESSION}", json={"title": SECRET})
check("rename: chat_renamed, no title", got == [("chat_renamed", {}, None)], got)

r, got, _ = server_events("DELETE", f"/api/history/{SESSION}")
check("delete: chat_deleted", r.status_code == 200 and got == [("chat_deleted", {}, None)], (r.status_code, got))


class MissingDB(FakeDB):
    def get_session_by_id(self, session_id, user_id):
        return None

    def delete_session(self, session_id, user_id):
        return False


main._db_for = lambda user: MissingDB()
r, got, _ = server_events("GET", f"/api/history/{SESSION}")
check("someone else's chat: 404 and no event", r.status_code == 404 and got == [], (r.status_code, got))
r, got, _ = server_events("DELETE", f"/api/history/{SESSION}")
check("delete of someone else's chat: no event", r.status_code == 404 and got == [], (r.status_code, got))
main._db_for = lambda user: FakeDB()

rpc = use_rpc(fail=True)
r = client.get(f"/api/history/{SESSION}")
check("a failed event write never fails the request", r.status_code == 200, r.status_code)
analytics.flush(5)


print()
if failures:
    print(f"{len(failures)} product event test(s) failed:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("All product event tests passed.")
