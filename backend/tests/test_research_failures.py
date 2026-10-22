"""
A failed synthesis must not be saved or cached as an answer. No network needed:
OpenAI and Tavily are faked, and nothing is written to a database.

    python tests/test_research_failures.py
"""
import os
import sys

# Set before importing main (see test_rate_limit.py).
for _k in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ANALYTICS_ADMIN_USER_IDS"):
    os.environ[_k] = ""
os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("TAVILY_API_KEY", "test")
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["SPEND_GUARD_ENABLED"] = "false"
os.environ["MODERATION_ENABLED"] = "false"
os.environ["ANALYTICS_ENABLED"] = "true"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio  # noqa: E402
import json  # noqa: E402
import threading  # noqa: E402
from types import SimpleNamespace as NS  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from agent import research_pipeline as rp  # noqa: E402
from utils import analytics  # noqa: E402

failures = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


ALICE = "11111111-1111-1111-1111-111111111111"
SESSION = "33333333-3333-3333-3333-333333333333"
QUERY = "how do heat pumps work in cold climates"
REPORT = "Heat pumps move heat rather than make it. " * 10
# Long enough that the old code would have saved the error text (it saves anything over 100 chars).
LONG_ERROR = "Error code: 503 - upstream model is overloaded, please retry your request later " * 2

fake = {"synthesis": "ok", "followup": "ok", "search": "ok"}


# ---------------------------------------------------------------------------
# Fakes: OpenAI, Tavily, the database and the analytics store
# ---------------------------------------------------------------------------

class FakeCompletions:
    async def create(self, **kw):
        prompt = kw["messages"][-1]["content"]
        system = kw["messages"][0]["content"]
        usage = NS(prompt_tokens=10, completion_tokens=5)
        if "search query optimizer" in prompt:
            subs = ["heat pump cold climate 0", "heat pump efficiency 1"]
            return NS(choices=[NS(message=NS(content=json.dumps(subs)))], usage=usage)
        if "follow-up question" in system:
            if fake["followup"] == "raise":
                raise RuntimeError(LONG_ERROR)
            return NS(choices=[NS(message=NS(content=REPORT))], usage=usage)
        if fake["synthesis"] == "raise":
            raise RuntimeError(LONG_ERROR)
        return NS(choices=[NS(message=NS(content=REPORT))], usage=usage)


rp.openai_client = NS(chat=NS(completions=FakeCompletions()))


async def _no_warm(n=4):
    return None


async def _fake_search(query, max_results=5):
    i = int(query.rsplit(" ", 1)[-1])
    if fake["search"] == "empty":
        return {"query": query, "answer": "", "results": [], "success": True}
    results = [
        {"url": f"https://example.org/{i}/{j}", "title": "t", "content": "c", "score": 0.9 - j / 10}
        for j in range(3)
    ]
    return {"query": query, "answer": "", "results": results, "success": True}


rp.warm_tavily_connections = _no_warm
rp._single_search = _fake_search


class FakeDB:
    is_connected = True
    schema_ready = True
    cached = None
    history = [
        {"id": "m1", "role": "user", "content": QUERY, "citations": [], "metadata": {}, "created_at": "x"},
        {"id": "m2", "role": "assistant", "content": REPORT, "citations": [], "metadata": {}, "created_at": "x"},
    ]

    def check_schema(self):
        return True

    def check_cache(self, query, user_id):
        return FakeDB.cached

    def get_conversation_history(self, session_id, user_id):
        return FakeDB.history


class CaptureStore:
    def __init__(self):
        self.rows = []
        self.lock = threading.Lock()

    def insert(self, row):
        with self.lock:
            self.rows.append(row)


saved = {"sessions": [], "followups": []}
main._persist_new_session = lambda *a, **k: saved["sessions"].append(a)
main._persist_followup = lambda *a, **k: saved["followups"].append(a)
main._db_for = lambda user: FakeDB()
main.app.dependency_overrides[main.get_current_user] = lambda: main.AuthedUser(id=ALICE, token="stub-token")

client = TestClient(main.app, raise_server_exceptions=False)


def reset():
    fake.update(synthesis="ok", followup="ok", search="ok")
    FakeDB.cached = None
    saved["sessions"].clear()
    saved["followups"].clear()
    analytics.flush()
    store = CaptureStore()
    analytics.store = store
    return store


def events(store):
    check("analytics writes drained", analytics.flush(5))
    return [(r["event_type"], r["failure_stage"]) for r in store.rows]


# ---------------------------------------------------------------------------
print("\n[1] New research: a failed synthesis is not saved")

reset()
fake["synthesis"] = "raise"
direct = asyncio.run(rp.research_complete(QUERY))
check("precondition: the pipeline still reports the failure as text over 100 chars",
      direct["analytics"]["failure_stage"] == "synthesis" and len(direct["output"]) > 100,
      direct["output"][:80])

store = reset()
fake["synthesis"] = "raise"
r = client.post("/api/research", json={"query": QUERY})
check("failed synthesis -> 500", r.status_code == 500, f"{r.status_code} {r.text[:120]}")
check("  ...with the generic message, not the provider error",
      r.json().get("detail") == "Failed to process research request" and "overloaded" not in r.text, r.text[:120])
check("  ...and no session saved (so nothing to serve from cache)", saved["sessions"] == [], str(saved["sessions"])[:120])
check("  ...recorded once as research_failed at 'synthesis'",
      events(store) == [("research_failed", "synthesis")], str(store.rows)[:200])


# ---------------------------------------------------------------------------
print("\n[2] New research: existing behavior is unchanged")

store = reset()
r = client.post("/api/research", json={"query": QUERY})
check("successful run -> 200 with the report", r.status_code == 200 and r.json()["output"] == REPORT, str(r.status_code))
check("  ...saved exactly once", len(saved["sessions"]) == 1, str(len(saved["sessions"])))
check("  ...recorded as research_completed", events(store) == [("research_completed", None)], str(store.rows)[:200])

store = reset()
fake["search"] = "empty"
r = client.post("/api/research", json={"query": QUERY})
check("no sources -> still 200 with the 'couldn't find' answer",
      r.status_code == 200 and r.json()["output"].startswith("I couldn't find relevant search results"),
      f"{r.status_code} {r.text[:120]}")
check("  ...and not saved (too short), as before", saved["sessions"] == [])


# ---------------------------------------------------------------------------
print("\n[3] Follow-ups: a failed answer is not saved into the conversation")

store = reset()
fake["followup"] = "raise"
r = client.post("/api/research", json={"query": "and in Norway?", "session_id": SESSION, "is_followup": True})
check("failed follow-up -> 500", r.status_code == 500, f"{r.status_code} {r.text[:120]}")
check("  ...and nothing persisted", saved["followups"] == [], str(saved["followups"])[:120])
check("  ...recorded as followup_failed at 'synthesis'",
      events(store) == [("followup_failed", "synthesis")], str(store.rows)[:200])

store = reset()
r = client.post("/api/research", json={"query": "and in Norway?", "session_id": SESSION, "is_followup": True})
check("successful follow-up -> 200 and persisted once",
      r.status_code == 200 and len(saved["followups"]) == 1, f"{r.status_code} {len(saved['followups'])}")


# ---------------------------------------------------------------------------
print("\n[4] Cache: failed runs saved before the fix are not served")

error_row = {"id": SESSION, "user_id": ALICE, "citations": [], "metadata": {},
             "report": f"Research synthesis encountered an error: {LONG_ERROR}"}
good_row = {"id": SESSION, "user_id": ALICE, "citations": [], "metadata": {}, "report": REPORT}

FakeDB.cached = error_row
check("error-text row is not a cache hit", asyncio.run(main._cached_session(FakeDB(), QUERY, ALICE)) is None)
FakeDB.cached = good_row
check("a normal report is still a cache hit", asyncio.run(main._cached_session(FakeDB(), QUERY, ALICE)) is good_row)

store = reset()
FakeDB.cached = error_row
r = client.post("/api/research", json={"query": QUERY})
check("/api/research with an error row cached runs fresh research instead",
      r.status_code == 200 and r.json()["output"] == REPORT and not r.json()["metadata"].get("from_cache"),
      f"{r.status_code} {r.text[:120]}")

main.app.dependency_overrides.clear()


print("\n" + "=" * 60)
if failures:
    print(f"FAILED ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("All research failure checks passed.")
