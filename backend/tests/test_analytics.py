"""
Product analytics tests. No network needed: OpenAI and Tavily are faked, and
analytics writes go to an in-memory store.

    python tests/test_analytics.py

Optional live RLS check against a real project with 0008 applied:

    ANALYTICS_LIVE_RLS_CHECK=1 ANALYTICS_LIVE_SUPABASE_URL=... \\
    ANALYTICS_LIVE_SUPABASE_ANON_KEY=... python tests/test_analytics.py
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
import logging  # noqa: E402
import re  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402
from types import SimpleNamespace as NS  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from agent import research_pipeline as rp  # noqa: E402
from utils import analytics, analytics_summary, moderation  # noqa: E402

failures = []
log_lines = []


class LogCapture(logging.Handler):
    def emit(self, record):
        log_lines.append(record.getMessage())


logging.getLogger().addHandler(LogCapture())


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


def run(coro):
    return asyncio.run(coro)


ALICE = "11111111-1111-1111-1111-111111111111"
BOB = "22222222-2222-2222-2222-222222222222"
SESSION = "33333333-3333-3333-3333-333333333333"

# None of these may ever reach an analytics row.
SECRET_QUERY = "SECRETQUERY-7f3a what is the capital"
SECRET_REPORT = "SECRETREPORT-91b2 "
SECRET_URL = "https://secret-source.example/SECRETURL-44c"
SECRET_SUBQUERY = "SECRETSUBQ-d00d"
SECRET_HISTORY = "SECRETHISTORY-5e5e"
SECRET_EMAIL = "alice-secret@example.com"
SECRETS = ("SECRETQUERY", "SECRETREPORT", "SECRETURL", "SECRETSUBQ", "SECRETHISTORY", SECRET_EMAIL, "stub-token")

ROW_KEYS = {
    "event_type", "request_type", "success", "failure_stage",
    "cache_hit", "estimated_cost_usd", "metadata",
} | set(analytics.MS_FIELDS) | set(analytics.COUNT_FIELDS)
METADATA_KEYS = {"transport", "pipeline", "decomposition_fallback", "synthesis_ttft_ms", "input_tokens", "output_tokens",
                 "cost_partial"}


# ---------------------------------------------------------------------------
# Fakes: OpenAI, Tavily, the database and the analytics store
# ---------------------------------------------------------------------------

DECOMP_USAGE = (100, 20)
SYNTH_USAGE = (1000, 300)
FOLLOWUP_USAGE = (500, 100)

fake = {"search": "ok", "synthesis": "ok", "stream_usage": True}


def _usage(pair):
    return NS(prompt_tokens=pair[0], completion_tokens=pair[1])


class FakeStream:
    def __init__(self, text, usage):
        words = [w + " " for w in text.split(" ")]
        self.chunks = [NS(choices=[NS(delta=NS(content=w))], usage=None) for w in words]
        if fake["stream_usage"]:
            self.chunks.append(NS(choices=[], usage=_usage(usage)))
        self.closed = False

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for chunk in self.chunks:
            yield chunk

    async def close(self):
        self.closed = True


class FakeCompletions:
    async def create(self, **kw):
        prompt = kw["messages"][-1]["content"]
        system = kw["messages"][0]["content"]
        if "search query optimizer" in prompt:
            subs = [f"{SECRET_SUBQUERY} {i}" for i in range(3)]
            return NS(choices=[NS(message=NS(content=json.dumps(subs)))], usage=_usage(DECOMP_USAGE))
        followup = "follow-up question" in system
        if not followup and fake["synthesis"] == "raise":
            raise RuntimeError("synthesis exploded")
        text, usage = (SECRET_REPORT * 10, FOLLOWUP_USAGE) if followup else (SECRET_REPORT * 20, SYNTH_USAGE)
        if kw.get("stream"):
            check("stream requests include_usage", kw.get("stream_options") == {"include_usage": True})
            return FakeStream(text, usage)
        return NS(choices=[NS(message=NS(content=text))], usage=_usage(usage))


rp.openai_client = NS(chat=NS(completions=FakeCompletions()))


async def _no_warm(n=4):
    return None


async def _fake_search(query, max_results=5):
    i = int(query.rsplit(" ", 1)[-1])
    mode = fake["search"]
    if mode == "none" or (mode == "partial" and i == 0):
        return {"query": query, "answer": "", "results": [], "success": False}
    if mode == "empty":
        return {"query": query, "answer": "", "results": [], "success": True}
    results = [
        {"url": f"{SECRET_URL}/{i}/{j}", "title": SECRET_REPORT, "content": SECRET_REPORT, "score": 0.9 - j / 10}
        for j in range(3)
    ]
    return {"query": query, "answer": SECRET_REPORT, "results": results, "success": True}


rp.warm_tavily_connections = _no_warm
rp._single_search = _fake_search


class FakeDB:
    is_connected = True
    schema_ready = True
    cached = None
    history = [
        {"id": "m1", "role": "user", "content": SECRET_HISTORY, "citations": [], "metadata": {}, "created_at": "x"},
        {"id": "m2", "role": "assistant", "content": SECRET_HISTORY, "citations": [], "metadata": {}, "created_at": "x"},
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
        self.users = []
        self.lock = threading.Lock()

    def insert(self, row, user_id=None):
        with self.lock:
            self.rows.append(row)
            self.users.append(user_id)


class RaisingStore:
    def insert(self, row, user_id=None):
        raise RuntimeError(f"database is down; row was {row}")


class BlockingStore:
    def __init__(self):
        self.release = threading.Event()

    def insert(self, row, user_id=None):
        self.release.wait(10)


main._persist_new_session = lambda *a, **k: None
main._persist_followup = lambda *a, **k: None
main._db_for = lambda user: FakeDB()

client = TestClient(main.app, raise_server_exceptions=False)


def as_user(uid):
    main.app.dependency_overrides[main.get_current_user] = \
        lambda: main.AuthedUser(id=uid, token="stub-token")


def capture():
    analytics.flush()
    store = CaptureStore()
    analytics.store = store
    return store


def rows_of(store):
    check("analytics writes drained", analytics.flush(5))
    return list(store.rows)


def reset_fakes():
    fake.update(search="ok", synthesis="ok", stream_usage=True)
    FakeDB.cached = None


def sse_events(body):
    return [frame.split("\n", 1)[0].removeprefix("event: ") for frame in body.strip().split("\n\n")]


as_user(ALICE)


# ---------------------------------------------------------------------------
print("\n[1] Pipeline: counts, ms timings and measured cost")

reset_fakes()
result = run(rp.research_complete(SECRET_QUERY))
a = result["analytics"]
expected_cost = round(
    (DECOMP_USAGE[0] + SYNTH_USAGE[0]) / 1e6 * rp.OPENAI_INPUT_USD_PER_1M
    + (DECOMP_USAGE[1] + SYNTH_USAGE[1]) / 1e6 * rp.OPENAI_OUTPUT_USD_PER_1M
    + 3 * rp.TAVILY_USD_PER_SEARCH,
    6,
)
check("timings are int milliseconds",
      all(isinstance(a[k], int) for k in ("decomposition_latency_ms", "search_latency_ms", "synthesis_latency_ms")))
check("subquery/search/source counts", (a["subquery_count"], a["successful_search_count"],
      a["total_search_count"], a["selected_source_count"]) == (3, 3, 3, 5), str(a))
check("tokens summed over decomposition + synthesis",
      (a["input_tokens"], a["output_tokens"]) == (1100, 320), str(a))
check("cost = tokens x price + searches x price", a["estimated_cost_usd"] == expected_cost,
      f"{a['estimated_cost_usd']} != {expected_cost}")
check("a good run has no failure stage", a["failure_stage"] is None)
check("response metadata is unchanged (no analytics inside)",
      set(result["metadata"]) == {"total_time", "sources_count", "sub_queries", "pipeline", "timing"},
      str(result["metadata"].keys()))

fake["search"] = "partial"
a = run(rp.research_complete(SECRET_QUERY))["analytics"]
check("partial search: 2 of 3 succeeded, still a completed run",
      (a["successful_search_count"], a["total_search_count"], a["failure_stage"]) == (2, 3, None), str(a))

fake["search"] = "none"
r = run(rp.research_complete(SECRET_QUERY))
check("every search failed -> stage 'search', 0 sources",
      (r["analytics"]["failure_stage"], r["analytics"]["selected_source_count"]) == ("search", 0), str(r["analytics"]))
check("  ...and the user-facing answer is unchanged", r["output"].startswith("I couldn't find relevant search results"))

fake["search"] = "empty"
a = run(rp.research_complete(SECRET_QUERY))["analytics"]
check("searches ok but no results -> stage 'search_no_results'", a["failure_stage"] == "search_no_results", str(a))

reset_fakes()
fake["synthesis"] = "raise"
r = run(rp.research_complete(SECRET_QUERY))
check("synthesis error string -> stage 'synthesis'", r["analytics"]["failure_stage"] == "synthesis")
check("  ...and the returned text is unchanged", r["output"].startswith("Research synthesis encountered an error"))


async def _collect(gen):
    return [e async for e in gen]


reset_fakes()
events = run(_collect(rp.research_stream(SECRET_QUERY)))
final = events[-1]
a = final["analytics"]
check("stream: synthesis TTFT is int ms", isinstance(a["synthesis_ttft_ms"], int), str(a))
check("stream: usage from the include_usage chunk is counted", a["estimated_cost_usd"] == expected_cost,
      f"{a['estimated_cost_usd']} != {expected_cost}")
check("stream: token text is unchanged", "".join(e["text"] for e in events if e["type"] == "token") == final["output"])
check("stream: metadata unchanged", "analytics" not in final["metadata"])
check("stream: final cost is not partial", "cost_partial" not in a)

progress = {e["type"]: e["analytics"] for e in events if e["type"] in ("stage", "sources")}
decomp_cost = round(DECOMP_USAGE[0] / 1e6 * rp.OPENAI_INPUT_USD_PER_1M
                    + DECOMP_USAGE[1] / 1e6 * rp.OPENAI_OUTPUT_USD_PER_1M, 6)
p = progress["stage"]
check("stage progress: sub-queries and decomposition cost, flagged partial",
      (p["subquery_count"], p["total_search_count"], p["estimated_cost_usd"], p["cost_partial"])
      == (3, None, decomp_cost, True), str(p))
p = progress["sources"]
check("sources progress: search counts and decomposition + search cost, flagged partial",
      (p["successful_search_count"], p["total_search_count"], p["selected_source_count"], p["cost_partial"])
      == (3, 3, 5, True) and p["estimated_cost_usd"] == round(decomp_cost + 3 * rp.TAVILY_USD_PER_SEARCH, 6),
      str(p))
check("progress holds numbers only", not any(x in json.dumps(progress) for x in SECRETS))

fake["stream_usage"] = False
a = run(_collect(rp.research_stream(SECRET_QUERY)))[-1]["analytics"]
check("no usage reported -> cost is None, not an undercount", a["estimated_cost_usd"] is None, str(a))

reset_fakes()
final = run(_collect(rp.handle_followup_stream(SECRET_QUERY, FakeDB.history)))[-1]
a = final["analytics"]
check("follow-up stream: tokens, cost, no failure",
      (a["input_tokens"], a["output_tokens"], a["failure_stage"]) == (500, 100, None), str(a))
r = run(rp.handle_followup(SECRET_QUERY, FakeDB.history))
check("follow-up sync: pipeline name and cost", r["analytics"]["pipeline"] == "direct_llm"
      and r["analytics"]["estimated_cost_usd"] > 0, str(r["analytics"]))


# ---------------------------------------------------------------------------
print("\n[2] Endpoints record the right events")

reset_fakes()
store = capture()
r = client.post("/api/research", json={"query": SECRET_QUERY})
check("sync research -> 200", r.status_code == 200, str(r.status_code))
body = r.json()
check("sync response shape unchanged", set(body) == {"output", "citations", "metadata", "session_id", "messages"})
check("sync response carries no analytics", '"analytics"' not in r.text)
rows = rows_of(store)
check("one research_completed event", [x["event_type"] for x in rows] == ["research_completed"], str(rows))
check("  ...passing the user to the store, not the row", store.users == [ALICE], str(store.users))
row = rows[0]
check("  ...with request-level latency, cost and counts",
      row["total_latency_ms"] is not None and row["estimated_cost_usd"] == expected_cost
      and row["selected_source_count"] == 5 and row["metadata"]["transport"] == "sync", str(row))

store = capture()
r = client.post("/api/research/stream", json={"query": SECRET_QUERY})
check("stream research -> done", sse_events(r.text)[-1] == "done", str(sse_events(r.text)))
check("stream body carries no analytics", '"analytics"' not in r.text)
rows = rows_of(store)
check("one research_completed event (stream)", [x["event_type"] for x in rows] == ["research_completed"], str(rows))
check("  ...with user-perceived TTFT <= total latency",
      rows and rows[0]["ttft_ms"] is not None and rows[0]["ttft_ms"] <= rows[0]["total_latency_ms"], str(rows))

FakeDB.cached = {"id": SESSION, "user_id": ALICE, "report": SECRET_REPORT * 20,
                 "citations": [{"url": SECRET_URL}], "metadata": {}}
store = capture()
client.post("/api/research", json={"query": SECRET_QUERY})
client.post("/api/research/stream", json={"query": SECRET_QUERY})
rows = rows_of(store)
check("cache hits (sync + stream) -> cache_hit events",
      [x["event_type"] for x in rows] == ["cache_hit", "cache_hit"], str(rows))
check("  ...flagged cache_hit with the source count",
      all(x["cache_hit"] and x["selected_source_count"] == 1 for x in rows))
FakeDB.cached = None

store = capture()
client.post("/api/research", json={"query": SECRET_QUERY, "session_id": SESSION, "is_followup": True})
client.post("/api/research/stream", json={"query": SECRET_QUERY, "session_id": SESSION, "is_followup": True})
rows = rows_of(store)
check("follow-ups -> followup_completed x2",
      [x["event_type"] for x in rows] == ["followup_completed", "followup_completed"], str(rows))
check("  ...stream follow-up has TTFT", rows[-1]["ttft_ms"] is not None)

saved_history = FakeDB.history
FakeDB.history = []
store = capture()
r1 = client.post("/api/research", json={"query": SECRET_QUERY, "session_id": SESSION, "is_followup": True})
r2 = client.post("/api/research/stream", json={"query": SECRET_QUERY, "session_id": SESSION, "is_followup": True})
rows = rows_of(store)
check("missing history: responses unchanged (404 / SSE error)",
      r1.status_code == 404 and sse_events(r2.text) == ["error"], f"{r1.status_code} {r2.text[:80]}")
check("  ...recorded as followup_failed at stage 'history'",
      [(x["event_type"], x["failure_stage"]) for x in rows]
      == [("followup_failed", "history")] * 2, str(rows))
FakeDB.history = saved_history

fake["search"] = "none"
store = capture()
r = client.post("/api/research/stream", json={"query": SECRET_QUERY})
rows = rows_of(store)
check("zero-result run: stream still ends in done", sse_events(r.text)[-1] == "done")
check("  ...recorded as research_failed at stage 'search'",
      [(x["event_type"], x["failure_stage"]) for x in rows] == [("research_failed", "search")], str(rows))
reset_fakes()


async def _stream_that_breaks(query):
    yield {"type": "stage", "phase": "decomposed", "sub_queries": ["x"]}
    raise RuntimeError("search exploded")


real_stream = main.research_stream
main.research_stream = _stream_that_breaks
store = capture()
r = client.post("/api/research/stream", json={"query": SECRET_QUERY})
main.research_stream = real_stream
rows = rows_of(store)
check("exception mid-stream: SSE error unchanged", sse_events(r.text)[-1] == "error")
check("  ...recorded at the stage it was in ('search')",
      [(x["event_type"], x["failure_stage"]) for x in rows] == [("research_failed", "search")], str(rows))


async def _stream_that_breaks_after_sources(query):
    # Real events up to "sources", then a failure mid-synthesis.
    async for event in real_stream(query):
        yield event
        if event["type"] == "sources":
            raise RuntimeError("synthesis exploded")


main.research_stream = _stream_that_breaks_after_sources
store = capture()
r = client.post("/api/research/stream", json={"query": SECRET_QUERY})
main.research_stream = real_stream
rows = rows_of(store)
check("failure after sources: SSE stream unchanged (stage, sources, error; no analytics)",
      sse_events(r.text) == ["stage", "sources", "error"] and '"analytics"' not in r.text
      and "cost_partial" not in r.text, str(sse_events(r.text)))
row = rows[0] if rows else {}
check("  ...recorded with the search counts and spend so far",
      (row.get("failure_stage"), row.get("successful_search_count"), row.get("total_search_count"),
       row.get("selected_source_count"), row.get("subquery_count")) == ("synthesis", 3, 3, 5, 3), str(row))
check("  ...cost covers decomposition + searches and is flagged partial",
      row.get("estimated_cost_usd") == round(decomp_cost + 3 * rp.TAVILY_USD_PER_SEARCH, 6)
      and row.get("metadata", {}).get("cost_partial") is True, str(row))


async def _broken_pipeline(query):
    raise RuntimeError("pipeline exploded")


real_complete = main.research_complete
main.research_complete = _broken_pipeline
store = capture()
r = client.post("/api/research", json={"query": SECRET_QUERY})
main.research_complete = real_complete
rows = rows_of(store)
check("sync pipeline exception: still 500", r.status_code == 500)
check("  ...recorded as research_failed at stage 'pipeline'",
      [(x["event_type"], x["failure_stage"]) for x in rows] == [("research_failed", "pipeline")], str(rows))

real_check = moderation.check


async def _flag_output(text, source, user_id=""):
    return moderation.Verdict(True, ["violence"]) if source == "output" else moderation.CLEAN


moderation.check = _flag_output
store = capture()
r1 = client.post("/api/research", json={"query": SECRET_QUERY})
r2 = client.post("/api/research/stream", json={"query": SECRET_QUERY})
moderation.check = real_check
rows = rows_of(store)
check("output moderation: responses unchanged (400 / blocked)",
      r1.status_code == 400 and sse_events(r2.text)[-1] == "blocked", f"{r1.status_code} {sse_events(r2.text)}")
check("  ...recorded at stage 'moderation_output'",
      [x["failure_stage"] for x in rows] == ["moderation_output"] * 2, str(rows))


async def _flag_input(text, source, user_id=""):
    return moderation.Verdict(True, ["violence"]) if source == "input" else moderation.CLEAN


moderation.check = _flag_input
store = capture()
client.post("/api/research", json={"query": SECRET_QUERY})
client.post("/api/research/stream", json={"query": SECRET_QUERY})
moderation.check = real_check
rows = rows_of(store)
check("requests turned away before any work are counted as blocked, with no category",
      [(x["event_type"], x["failure_stage"]) for x in rows] == [("request_blocked", "moderation")] * 2
      and "violence" not in json.dumps(rows), str(rows))
check("  ...and never linked to a person", store.users == [None, None], str(store.users))


# ---------------------------------------------------------------------------
print("\n[3] No raw query, report, URL, history, email or token enters analytics")

reset_fakes()
store = capture()
FakeDB.cached = {"id": SESSION, "user_id": ALICE, "report": SECRET_REPORT * 20,
                 "citations": [{"url": SECRET_URL}], "metadata": {}}
client.post("/api/research", json={"query": SECRET_QUERY})
FakeDB.cached = None
client.post("/api/research", json={"query": SECRET_QUERY})
client.post("/api/research/stream", json={"query": SECRET_QUERY})
client.post("/api/research", json={"query": SECRET_QUERY, "session_id": SESSION, "is_followup": True})
client.post("/api/research/stream", json={"query": SECRET_QUERY, "session_id": SESSION, "is_followup": True})
fake["search"] = "none"
client.post("/api/research/stream", json={"query": SECRET_QUERY})
reset_fakes()
rows = rows_of(store)
dump = json.dumps(rows)
check(f"captured {len(rows)} events across every path", len(rows) == 6, str(len(rows)))
leaked = [s for s in SECRETS if s in dump]
check("no sentinel text in any row", not leaked, str(leaked))
leaked_logs = [line for line in log_lines if any(s in line for s in SECRETS)]
check("no question, answer or search text in any log line", not leaked_logs, str(leaked_logs[:3]))
check("logs were captured", len(log_lines) > 20, str(len(log_lines)))
check("every row has exactly the allowed columns", all(set(x) == ROW_KEYS for x in rows),
      str([set(x) ^ ROW_KEYS for x in rows]))
check("metadata keys are all allowlisted", all(set(x["metadata"]) <= METADATA_KEYS for x in rows))

row = analytics.build_event(
    "research_completed",
    user_id=ALICE,
    session_id=SECRET_QUERY,
    metadata={"query": SECRET_QUERY, "pipeline": SECRET_QUERY, "transport": "stream",
              "input_tokens": 12, "output_tokens": SECRET_REPORT, "url": SECRET_URL},
    report=SECRET_REPORT,
    total_latency_ms=SECRET_QUERY,
    search_latency_ms=float("nan"),
    ttft_ms=-5,
    subquery_count=3.6,
)
dump = json.dumps(row)
check("build_event: free text in metadata, metrics and session id is dropped",
      not any(s in dump for s in SECRETS), dump)
check("build_event: only allowlisted metadata survives", row["metadata"] == {"transport": "stream", "input_tokens": 12},
      str(row["metadata"]))
check("build_event: unknown metric kwargs are not columns", "report" not in row)
check("build_event: non-numeric / NaN / negative timings become None",
      (row["total_latency_ms"], row["search_latency_ms"], row["ttft_ms"]) == (None, None, None))
check("build_event: counts are rounded ints", row["subquery_count"] == 4)
row = analytics.build_event("research_failed", failure_stage=SECRET_QUERY)
check("build_event: unknown stage -> 'internal'", row["failure_stage"] == "internal", str(row))
row = analytics.build_event("research_completed", user_id=ALICE, session_id=SESSION)
check("build_event: rows never hold a user or session id",
      ALICE not in json.dumps(row) and SESSION not in json.dumps(row), str(row))


# ---------------------------------------------------------------------------
print("\n[4] Analytics failures never fail or slow down research")

analytics.flush()
analytics.store = RaisingStore()
r1 = client.post("/api/research", json={"query": SECRET_QUERY})
r2 = client.post("/api/research/stream", json={"query": SECRET_QUERY})
check("store raising: sync research still 200", r1.status_code == 200, str(r1.status_code))
check("store raising: stream still ends in done", sse_events(r2.text)[-1] == "done")
check("store raising: writes drain", analytics.flush(5))

analytics.store = analytics.SupabaseAnalyticsStore(lambda: None)
r = client.post("/api/research", json={"query": SECRET_QUERY})
check("no service-role client: research still 200", r.status_code == 200)
check("no service-role client: writes drain", analytics.flush(5))

blocking = BlockingStore()
analytics.store = blocking
started = time.perf_counter()
r = client.post("/api/research", json={"query": SECRET_QUERY})
elapsed = time.perf_counter() - started
check("store hanging: research still 200", r.status_code == 200)
check(f"store hanging: response not delayed ({elapsed:.2f}s)", elapsed < 2.0)
blocking.release.set()
check("store hanging: write finishes once released", analytics.flush(5))

store = capture()
analytics.ENABLED = False
client.post("/api/research", json={"query": SECRET_QUERY})
analytics.ENABLED = True
check("ANALYTICS_ENABLED=false records nothing", rows_of(store) == [])

blocking = BlockingStore()
analytics.store = blocking
saved_cap = analytics._MAX_PENDING
analytics._MAX_PENDING = 3
for _ in range(10):
    analytics.record("research_completed", user_id=ALICE)
check("backlog is capped (excess events dropped, not queued)", analytics._pending == 3, str(analytics._pending))
blocking.release.set()
analytics.flush(5)
analytics._MAX_PENDING = saved_cap

analytics.record("not_an_event", user_id=ALICE)
check("record() swallows a bad event type", True)

store = capture()
tracker = analytics.RequestTracker(ALICE, "research", "stream")
tracker.finish("client_disconnect")
check("tracker: nothing recorded before paid work starts", rows_of(store) == [])
tracker.stage = "synthesis"
tracker.finish("client_disconnect")
tracker.completed()
rows = rows_of(store)
check("tracker: disconnect after work started is recorded once",
      [(x["event_type"], x["failure_stage"]) for x in rows] == [("research_failed", "client_disconnect")], str(rows))

store = capture()
tracker = analytics.RequestTracker(ALICE, "research", "stream")
tracker.stage = "synthesis"
tracker.update_progress(None)
tracker.update_progress({"subquery_count": 4, "successful_search_count": 3, "total_search_count": 4,
                         "selected_source_count": 5, "estimated_cost_usd": 0.0321, "cost_partial": True,
                         "pipeline": "stream_v1"})
tracker.finish("client_disconnect")
rows = rows_of(store)
row = rows[0] if rows else {}
check("tracker: a disconnect keeps the progress seen so far",
      (row.get("failure_stage"), row.get("successful_search_count"), row.get("total_search_count"),
       row.get("selected_source_count"), row.get("estimated_cost_usd"))
      == ("client_disconnect", 3, 4, 5, 0.0321), str(row))
check("tracker: ...with cost_partial in metadata", row.get("metadata", {}).get("cost_partial") is True, str(row))

store = capture()
tracker = analytics.RequestTracker(ALICE, "research", "stream")
tracker.stage = "synthesis"
tracker.update_progress({"selected_source_count": 5, "cost_partial": True})
tracker.completed(analytics={"selected_source_count": 4})
row = (rows_of(store) or [{}])[0]
check("tracker: a completed run uses its final numbers, not progress",
      row.get("selected_source_count") == 4 and "cost_partial" not in row.get("metadata", {}), str(row))


# ---------------------------------------------------------------------------
print("\n[5] Admin summary is admins only, and every read is logged")

AUDIT_SECRET = "a" * 64
os.environ["ANALYTICS_AUDIT_LOG_SECRET"] = AUDIT_SECRET
CODED = "c0ffee" + "0" * 26


class FakeQuery:
    def __init__(self, owner, name, rows):
        self.owner = owner
        self.name = name
        self.rows = rows
        self.lo, self.hi = 0, 0

    def select(self, cols):
        self.owner.selected.append((self.name, cols))
        return self

    def gte(self, col, value):
        self.owner.since.append(value)
        return self

    def eq(self, col, value):
        self.rows = [r for r in self.rows if r.get(col) == value]
        return self

    def order(self, col):
        return self

    def limit(self, n):
        self.lo, self.hi = 0, n - 1
        return self

    def range(self, lo, hi):
        self.lo, self.hi = lo, hi
        return self

    def insert(self, row):
        if self.owner.insert_fails:
            raise RuntimeError("insert failed")
        self.owner.inserted.append((self.name, row))
        return self

    def execute(self):
        # Mimics a PostgREST max-rows cap smaller than the page size.
        if self.rows is None:
            raise RuntimeError("relation does not exist")
        end = min(self.hi + 1, self.lo + self.owner.server_cap)
        return NS(data=self.rows[self.lo:end])


class FakeAdminClient:
    # feedback_rows=None acts like 0009 not being applied.
    def __init__(self, rows, server_cap=1000, feedback_rows=(), product_rows=(), audit_key=None):
        from utils import analytics_keys

        if audit_key is None:
            audit_key = {"name": "audit", "fingerprint": analytics_keys.fingerprint("audit"), "state": "ok",
                         "epoch": 3}
        self.tables = {"analytics_events": rows, "answer_feedback": feedback_rows,
                       "product_events": product_rows, "analytics_key_check": [audit_key],
                       "analytics_access_log": []}
        self.server_cap = server_cap
        self.selected = []
        self.since = []
        self.inserted = []
        self.insert_fails = False

    def table(self, name):
        rows = self.tables[name]
        return FakeQuery(self, name, None if rows is None else list(rows))

    def access_rows(self):
        return [row for name, row in self.inserted if name == "analytics_access_log"]


from analytics_fakes import FakePrivacyStore  # noqa: E402
from utils import analytics_keys, analytics_privacy  # noqa: E402

real_store = analytics_privacy.store
analytics_privacy.store = FakePrivacyStore()
analytics_privacy.store.health_data = {
    "last_purge_at": datetime.now(timezone.utc).isoformat(), "pending_erasures": 0,
    "key_states": {"id": "ok", "audit": "ok"}, "oldest_row_seconds": {},
}

now = datetime.now(timezone.utc)
sample_rows = [
    {"id": 1, "created_at": now.isoformat(), "actor_id": ALICE, "event_type": "research_completed",
     "request_type": "research", "failure_stage": None, "total_latency_ms": 9000, "ttft_ms": 4000,
     "search_latency_ms": 2000, "subquery_count": 3, "successful_search_count": 3, "total_search_count": 3,
     "selected_source_count": 5, "estimated_cost_usd": "0.0250"},
    {"id": 2, "created_at": now.isoformat(), "actor_id": BOB, "event_type": "research_failed",
     "request_type": "research", "failure_stage": "search", "total_latency_ms": 7000, "ttft_ms": None,
     "search_latency_ms": 6000, "subquery_count": 3, "successful_search_count": 0, "total_search_count": 3,
     "selected_source_count": 0, "estimated_cost_usd": 0.0241},
    {"id": 3, "created_at": now.isoformat(), "actor_id": None, "event_type": "request_blocked",
     "request_type": "research", "failure_stage": "rate_limit"},
]
product_rows = [{"id": i, "created_at": now.isoformat(), "actor_id": CODED, "event": "chat_opened"}
                for i in range(3)]

main.app.dependency_overrides.clear()
r = client.get("/api/admin/analytics/summary")
check("no token -> 401", r.status_code == 401, str(r.status_code))

as_user(ALICE)
os.environ["ANALYTICS_ADMIN_USER_IDS"] = ""
r = client.get("/api/admin/analytics/summary")
check("admin list unset -> 403 even for Alice", r.status_code == 403, str(r.status_code))

os.environ["ANALYTICS_ADMIN_USER_IDS"] = f"  {ALICE.upper()} , "
real_admin = main.get_admin_client
fake_admin = FakeAdminClient(sample_rows, feedback_rows=[
    {"id": 1, "rating": "up", "is_followup": False, "created_at": now.isoformat()},
], product_rows=product_rows)
main.get_admin_client = lambda: fake_admin
as_user(BOB)
r = client.get("/api/admin/analytics/summary")
check("Bob (not listed) -> 403", r.status_code == 403, str(r.status_code))
check("a refused read writes no access-log row", fake_admin.access_rows() == [], str(fake_admin.inserted))

as_user(ALICE)
main.get_admin_client = lambda: None
r = client.get("/api/admin/analytics/summary")
check("admin, no service-role client -> 503", r.status_code == 503, str(r.status_code))

main.get_admin_client = lambda: fake_admin
r = client.get("/api/admin/analytics/summary?days=30")
check("Alice (listed, any case/whitespace) -> 200", r.status_code == 200, r.text[:200])
body = r.json()
check("summary is never cached", r.headers.get("cache-control") == "no-store", str(r.headers))
check("summary is aggregates only (no user ids in the body)", ALICE not in r.text and BOB not in r.text)
check("no coded id anywhere in the body", not re.search(r"[0-9a-f]{32}", r.text), r.text[:300])
check("summary has the expected sections",
      set(body) == {"period_days", "from", "to", "truncated", "research", "followups", "feedback",
                    "retention", "total_estimated_cost_usd", "failures_by_stage", "blocked", "daily",
                    "product", "consenting_users", "floors", "health"}, str(set(body)))
check("one rating is hidden as fewer than 5 events",
      body["feedback"]["ratings"] == {"value": None, "hidden": "events", "floor": 5}
      and body["feedback"]["up_rate"]["value"] is None, str(body["feedback"]))
check("system totals stay visible",
      body["research"]["total_requests"] == 2 and body["blocked"]["by_reason"]["rate_limit"] == 1, str(body["blocked"]))
check("consenting users under 5 are hidden",
      body["consenting_users"]["active"]["hidden"] == "contributors", str(body["consenting_users"]))
check("health comes from the same checks as purge-health", body["health"]["ok"] is True, str(body["health"]))
check("floors are reported", body["floors"] == {"contributors": 5, "events": 5}, str(body["floors"]))

logged = fake_admin.access_rows()
check("one read -> exactly one access-log row", len(logged) == 1, str(logged))
row = logged[0] if logged else {}
check("the log records the admin reference and key epoch",
      row.get("admin_ref") == analytics_keys.admin_ref(ALICE) and row.get("key_epoch") == 3, str(row))
check("the admin reference can't be joined with coded ids",
      row.get("admin_ref") != analytics_keys.actor_id(ALICE, AUDIT_SECRET.encode()) and ALICE not in str(row))
check("the log records what was asked, not whose data appeared",
      row.get("action") == "summary" and row.get("params") == {"days": 30}, str(row))

selected = dict(fake_admin.selected)
check("feedback read selects no ids or text",
      selected.get("answer_feedback") == "id,rating,is_followup,created_at", str(fake_admin.selected))
check("summary reads only the columns it needs",
      "*" not in selected["analytics_events"] and "metadata" not in selected["analytics_events"])
check("feature use never reads props or visit_id",
      selected.get("product_events") == "id,created_at,actor_id,event", str(selected.get("product_events")))
check("days=30 -> 30 daily buckets", len(body["daily"]) == 30)
for bad in (0, 91):
    r = client.get(f"/api/admin/analytics/summary?days={bad}")
    check(f"days={bad} -> 422", r.status_code == 422, str(r.status_code))
main.get_admin_client = lambda: FakeAdminClient(sample_rows, feedback_rows=None)
r = client.get("/api/admin/analytics/summary")
check("feedback table missing: summary still 200, feedback null",
      r.status_code == 200 and r.json()["feedback"] is None, r.text[:200])

print("  fails closed when the read can't be logged:")


def refused(admin, label):
    main.get_admin_client = lambda: admin
    r = client.get("/api/admin/analytics/summary")
    check(f"{label} -> 503 with no data",
          r.status_code == 503 and "research" not in r.text and admin.access_rows() == [], r.text[:200])


os.environ["ANALYTICS_AUDIT_LOG_SECRET"] = ""
refused(FakeAdminClient(sample_rows), "audit secret missing")
os.environ["ANALYTICS_AUDIT_LOG_SECRET"] = AUDIT_SECRET
refused(FakeAdminClient(sample_rows, audit_key={"name": "audit", "fingerprint": analytics_keys.fingerprint("audit"),
                                                "state": "unavailable", "epoch": 3}), "audit key unavailable")
refused(FakeAdminClient(sample_rows, audit_key={"name": "audit", "fingerprint": "0" * 64, "state": "ok",
                                                "epoch": 3}), "secret isn't the installed key")
broken = FakeAdminClient(sample_rows)
broken.insert_fails = True
refused(broken, "log insert fails")

failing = FakeAdminClient(None)
main.get_admin_client = lambda: failing
r = client.get("/api/admin/analytics/summary")
check("a failed build is still logged", r.status_code == 500 and len(failing.access_rows()) == 1, r.text[:200])

analytics_privacy.store.down.add("health")
main.get_admin_client = lambda: FakeAdminClient(sample_rows)
r = client.get("/api/admin/analytics/summary")
check("a failed health read doesn't fail the page",
      r.status_code == 200 and r.json()["health"]["problems"] == ["health_check_failed"], r.text[:200])
analytics_privacy.store = real_store
main.get_admin_client = real_admin
os.environ["ANALYTICS_ADMIN_USER_IDS"] = ""


# ---------------------------------------------------------------------------
print("\n[6] RLS: no anonymous or cross-user reads")

migration_path = os.path.join(os.path.dirname(__file__), "..", "..", "supabase", "migrations",
                              "0008_analytics_events.sql")
with open(migration_path) as f:
    sql_raw = f.read()
sql = re.sub(r"--[^\n]*", "", sql_raw).lower()
check("RLS enabled", "alter table public.analytics_events enable row level security" in sql)
check("anon and authenticated lose every privilege",
      "revoke all on public.analytics_events from anon, authenticated" in sql)
check("no policies (only the service role can read or write)", "create policy" not in sql)
check("no grants to anon, authenticated or public",
      not re.search(r"grant[^;]*to[^;]*\b(anon|authenticated|public)\b", sql))
check("no open USING (true)", "using (true)" not in sql.replace("  ", " "))
with open(os.path.join(os.path.dirname(migration_path), "0011_analytics_privacy.sql")) as f:
    quoted = set(re.findall(r"'([a-z_]+)'", f.read().lower()))
quoted |= set(re.findall(r"'([a-z_]+)'", sql))
check("SQL allows every event type the backend writes", analytics.EVENT_TYPES <= quoted)
check("SQL allows every failure stage the backend writes", analytics.FAILURE_STAGES <= quoted)

if os.getenv("ANALYTICS_LIVE_RLS_CHECK") == "1":
    import httpx

    url = os.environ["ANALYTICS_LIVE_SUPABASE_URL"].rstrip("/")
    key = os.environ["ANALYTICS_LIVE_SUPABASE_ANON_KEY"]
    resp = httpx.get(f"{url}/rest/v1/analytics_events?select=id&limit=1",
                     headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=10)
    denied = resp.status_code in (401, 403) or (resp.status_code == 200 and resp.json() == [])
    check(f"live: anon key cannot read analytics_events ({resp.status_code})", denied, resp.text[:200])
else:
    print("  SKIP  live anon-key read (set ANALYTICS_LIVE_RLS_CHECK=1 to run against a project)")


# ---------------------------------------------------------------------------
print("\n[7] Summary math: empty, zero-result and partial-search data")

fixed_now = datetime(2026, 10, 12, 15, 0, tzinfo=timezone.utc)
empty = analytics_summary.summarize([], 7, fixed_now)
check("empty: rates are None, not 0",
      (empty["research"]["completion_rate"], empty["research"]["cache_hit_rate"],
       empty["followups"]["completion_rate"]) == (None, None, None))
check("empty: distributions have no median and 0 samples",
      empty["research"]["latency_ms"] == {"median": None, "p95": None, "samples": 0})
check("empty: averages and cost are None",
      empty["research"]["avg_selected_sources"] is None and empty["research"]["avg_cost_per_completed_usd"] is None)
check("empty: 7 zero-filled UTC days ending today",
      [d["date"] for d in empty["daily"]][-1] == "2026-10-12" and len(empty["daily"]) == 7
      and all(d["requests"] == 0 and d["active_users"] == 0 for d in empty["daily"]))
check("window starts at midnight UTC, 6 days back", empty["from"] == "2026-10-06T00:00:00+00:00", empty["from"])


def ev(event_type, day=0, user=ALICE, **fields):
    created = (fixed_now - timedelta(days=day)).isoformat()
    request_type = "followup" if event_type.startswith("followup") else "research"
    return {"created_at": created, "actor_id": user, "event_type": event_type, "request_type": request_type, **fields}


rows = [
    ev("research_completed", total_latency_ms=1000, ttft_ms=400, search_latency_ms=300, subquery_count=3,
       successful_search_count=3, total_search_count=3, selected_source_count=5, estimated_cost_usd=0.03),
    ev("research_completed", total_latency_ms=2000, ttft_ms=None, search_latency_ms=500, subquery_count=4,
       successful_search_count=2, total_search_count=4, selected_source_count=4, estimated_cost_usd="0.05"),
    ev("research_completed", day=1, user=BOB, total_latency_ms=3000, ttft_ms=600, search_latency_ms=None,
       subquery_count=3, successful_search_count=3, total_search_count=3, selected_source_count=5,
       estimated_cost_usd=None),
    ev("research_completed", day=1, total_latency_ms=4000, ttft_ms=800, search_latency_ms=700, subquery_count=2,
       successful_search_count=2, total_search_count=2, selected_source_count=3, estimated_cost_usd=0.04),
    ev("research_failed", failure_stage="search_no_results", total_latency_ms=900, search_latency_ms=6000,
       subquery_count=3, successful_search_count=3, total_search_count=3, selected_source_count=0,
       estimated_cost_usd=0.025),
    ev("research_failed", failure_stage="search", search_latency_ms=6100, subquery_count=3,
       successful_search_count=0, total_search_count=3, selected_source_count=0),
    ev("cache_hit", user=BOB, total_latency_ms=50, selected_source_count=5),
    ev("followup_completed", day=2, total_latency_ms=1500, ttft_ms=300),
    ev("followup_failed", day=2, user=None, failure_stage="history"),
]
s = analytics_summary.summarize(rows, 7, fixed_now)
res = s["research"]
check("totals: 7 research = 4 fresh ok + 2 failed + 1 cache",
      (res["total_requests"], res["completed_requests"], res["failed_requests"], res["cache_hits"]) == (7, 5, 2, 1),
      str(res))
check("completion rate counts cache hits", res["completion_rate"] == round(5 / 7, 4))
check("pipeline completion rate excludes cache hits", res["pipeline_completion_rate"] == round(4 / 6, 4))
check("cache-hit rate", res["cache_hit_rate"] == round(1 / 7, 4))
check("latency over completed fresh runs: median 2500, p95 3850",
      res["latency_ms"] == {"median": 2500.0, "p95": 3850.0, "samples": 4}, str(res["latency_ms"]))
check("TTFT skips the run without one", res["ttft_ms"]["samples"] == 3 and res["ttft_ms"]["median"] == 600.0)
check("search latency includes failed runs and skips None",
      res["search_latency_ms"]["samples"] == 5, str(res["search_latency_ms"]))
check("avg successful searches (completed only)", res["avg_successful_searches"] == 2.5)
check("avg selected sources (completed only)", res["avg_selected_sources"] == 4.25)
check("avg subqueries (completed only)", res["avg_subqueries"] == 3.0)
check("partial-search rate: 1 of 6 runs that searched", res["partial_search_rate"] == round(1 / 6, 4),
      str(res["partial_search_rate"]))
check("avg cost per completed: string costs parsed, None skipped",
      res["avg_cost_per_completed_usd"] == 0.04 and res["cost_samples"] == 3, str(res))
check("total cost includes failed runs", s["total_estimated_cost_usd"] == 0.145, str(s["total_estimated_cost_usd"]))
check("failures grouped by stage and request type",
      s["failures_by_stage"] == {"research": {"search_no_results": 1, "search": 1}, "followup": {"history": 1}},
      str(s["failures_by_stage"]))
check("follow-up completion rate", s["followups"]["completion_rate"] == 0.5)
daily = {d["date"]: d for d in s["daily"]}
check("daily requests", (daily["2026-10-12"]["requests"], daily["2026-10-11"]["requests"],
                         daily["2026-10-10"]["requests"]) == (5, 2, 2), str(s["daily"]))
check("daily active users are distinct and skip deleted (null) users",
      (daily["2026-10-12"]["active_users"], daily["2026-10-11"]["active_users"],
       daily["2026-10-10"]["active_users"]) == (2, 2, 1), str(s["daily"]))

only_zero_result = analytics_summary.summarize(
    [ev("research_failed", failure_stage="search_no_results", successful_search_count=3, total_search_count=3,
        selected_source_count=0)], 7, fixed_now)
check("only a zero-result run: completion 0.0, averages None, no crash",
      only_zero_result["research"]["completion_rate"] == 0.0
      and only_zero_result["research"]["avg_selected_sources"] is None
      and only_zero_result["research"]["latency_ms"]["samples"] == 0)

check("percentile: single value", analytics_summary.percentile([42], 0.95) == 42)
check("percentile: empty", analytics_summary.percentile([], 0.5) is None)

paged = FakeAdminClient([{"id": i} for i in range(7)], server_cap=2)
got, truncated = analytics_summary.fetch_rows(paged, fixed_now)
check("paging follows a server row cap below the page size", (len(got), truncated) == (7, False))
saved_max = analytics_summary.MAX_ROWS
analytics_summary.MAX_ROWS = 5
got, truncated = analytics_summary.fetch_rows(FakeAdminClient([{"id": i} for i in range(9)], server_cap=2), fixed_now)
analytics_summary.MAX_ROWS = saved_max
check("row cap reached -> truncated flag", (len(got), truncated) == (5, True), f"{len(got)} {truncated}")


print("\n[8] Feedback and retention")

fb = analytics_summary.summarize_feedback([], 0)
check("feedback, no ratings: counts 0, rates None",
      (fb["ratings"], fb["up_rate"], fb["research_up_rate"], fb["ratings_per_answer"]) == (0, None, None, None), str(fb))
fb = analytics_summary.summarize_feedback([
    {"rating": "up", "is_followup": False}, {"rating": "up", "is_followup": False},
    {"rating": "down", "is_followup": False}, {"rating": "down", "is_followup": True},
], 8)
check("feedback: totals and up rate", (fb["ratings"], fb["up"], fb["down"], fb["up_rate"]) == (4, 2, 2, 0.5), str(fb))
check("feedback: split by research and follow-up",
      (fb["research_up_rate"], fb["followup_up_rate"]) == (round(2 / 3, 4), 0.0), str(fb))
check("feedback: ratings per completed answer", fb["ratings_per_answer"] == 0.5)
s = analytics_summary.summarize(rows, 7, fixed_now)
check("summarize without feedback rows -> feedback None", s["feedback"] is None)

empty_retention = analytics_summary.summarize_retention([], 7, fixed_now)
check("retention, no data: 0 eligible and rate None",
      all(empty_retention[k] == {"eligible": 0, "retained": 0, "rate": None} for k in ("d1", "d7", "d30"))
      and empty_retention["new_users"] == 0, str(empty_retention))


def seen(user, days_ago):
    return {"actor_id": user, "created_at": (fixed_now - timedelta(days=days_ago)).isoformat()}


CAROL = "44444444-4444-4444-4444-444444444444"
DAVE = "55555555-5555-5555-5555-555555555555"
activity = [
    seen(ALICE, 40), seen(ALICE, 37),                 # back on day 3
    seen(BOB, 40),                                    # never back
    seen(CAROL, 10), seen(CAROL, 9), seen(CAROL, 9),  # back on day 1, same day twice
    seen(DAVE, 0),                                    # first seen today
    {"actor_id": None, "created_at": fixed_now.isoformat()},
]
ret = analytics_summary.summarize_retention(activity, 7, fixed_now)
check("d1: Alice, Bob, Carol eligible; only Carol back the next day",
      ret["d1"] == {"eligible": 3, "retained": 1, "rate": round(1 / 3, 4)}, str(ret["d1"]))
check("d7: Alice (day 3) and Carol (day 1) back within 7 days",
      ret["d7"] == {"eligible": 3, "retained": 2, "rate": round(2 / 3, 4)}, str(ret["d7"]))
check("d30: only Alice and Bob are old enough",
      ret["d30"] == {"eligible": 2, "retained": 1, "rate": 0.5}, str(ret["d30"]))
check("new users in the 7-day window: Dave only (deleted users skipped)", ret["new_users"] == 1, str(ret))


print("\n[9] Small groups are hidden")

from utils import analytics_thresholds as th  # noqa: E402

for value, want in (("", 5), ("2", 5), ("10", 10), ("lots", 5)):
    os.environ["ANALYTICS_MIN_CONTRIBUTORS"] = value
    check(f"contributor floor from {value!r} -> {want}", th.floors()["contributors"] == want, str(th.floors()))
os.environ["ANALYTICS_MIN_CONTRIBUTORS"] = ""
os.environ["ANALYTICS_MIN_EVENTS"] = "1"
check("the event floor can't go below 5 either", th.floors()["events"] == 5)
os.environ["ANALYTICS_MIN_EVENTS"] = ""

group = th.protect_group({"a": 10, "b": 3, "c": 8}, th.EVENTS, 5)
check("a lone hidden cell takes the next smallest with it",
      group["b"]["hidden"] == "events" and group["c"]["hidden"] == "events" and group["a"] == {"value": 10}, str(group))
group = th.protect_group({"a": 10, "b": 3, "c": 8}, th.EVENTS, 5, total_shown=False)
check("no total shown -> nothing to subtract from", group["c"] == {"value": 8}, str(group))
group = th.protect_group({"a": 10, "b": 3, "c": 2}, th.EVENTS, 5)
check("two hidden cells can't be told apart", group["a"] == {"value": 10}, str(group))

FLOORS = {"contributors": 5, "events": 5}
small = analytics_summary.protect(analytics_summary.summarize(rows, 7, fixed_now),
                                  analytics_summary.summarize_product([]), 2, FLOORS)
check("2 daily users -> hidden as fewer than 5 contributors",
      all(d["active_users"].get("hidden") == "contributors" for d in small["daily"]), str(small["daily"][-1]))
check("daily requests stay visible", [d["requests"] for d in small["daily"]][-1] == 5)
check("research totals and failures stay visible",
      small["research"]["total_requests"] == 7 and small["failures_by_stage"]["research"]["search"] == 1)

crowd = [seen(f"user-{i}", 20) for i in range(8)] + [seen(f"user-{i}", 19) for i in range(3)]
retention = analytics_summary.protect(
    analytics_summary.summarize([], 7, fixed_now, activity_rows=crowd),
    analytics_summary.summarize_product([]), 8, FLOORS)["retention"]
check("8 eligible shown, 3 retained hidden, and the rate hidden with them",
      retention["d1"]["eligible"] == {"value": 8} and retention["d1"]["retained"]["hidden"] == "contributors"
      and retention["d1"]["rate"]["value"] is None, str(retention["d1"]))

ratings = [{"rating": "up", "is_followup": False}] * 7 + [{"rating": "down", "is_followup": False}]
fb = analytics_summary.protect(analytics_summary.summarize(rows, 7, fixed_now, feedback_rows=ratings),
                               analytics_summary.summarize_product([]), 0, FLOORS)["feedback"]
check("7 up and 1 down: both hidden, so the 1 can't be subtracted out",
      fb["ratings"] == {"value": 8} and fb["up"]["value"] is None and fb["down"]["value"] is None
      and fb["up_rate"]["value"] is None, str(fb))
check("no research/follow-up split, which would subtract to a hidden count",
      not any(k.startswith(("research_", "followup_")) for k in fb), str(sorted(fb)))

product_rows = ([{"actor_id": f"{i:032x}", "event": "chat_opened"} for i in range(6)]
                + [{"actor_id": "f" * 32, "event": "audio_generated"}, {"actor_id": "f" * 32, "event": "made_up"}])
raw = analytics_summary.summarize_product(product_rows)
check("unknown event names are left out of the total", raw["total_events"] == 7, str(raw["total_events"]))
product = analytics_summary.protect(analytics_summary.summarize([], 7, fixed_now), raw, 7, FLOORS)["product"]
check("6 chat opens by 6 people are shown",
      product["by_event"]["chat_opened"] == {"events": {"value": 6}, "contributors": {"value": 6}}, str(product))
check("1 audio event is hidden", product["by_event"]["audio_generated"]["events"]["hidden"] == "events")
check("every allowlisted event is listed, even with no use",
      "history_searched" in product["by_event"] and "made_up" not in product["by_event"])
check("no coded id leaves protect()", not re.search(r"[0-9a-f]{32}", json.dumps(product)))

main.app.dependency_overrides.clear()
analytics.flush()

print()
if failures:
    print(f"{len(failures)} FAILED")
    sys.exit(1)
print("All analytics tests passed.")
