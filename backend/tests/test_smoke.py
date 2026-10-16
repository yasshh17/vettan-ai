"""
The staging smoke test script, run against a fake backend, plus the two backend
settings staging relies on (/health commit, CORS for preview URLs).

    python tests/test_smoke.py
"""
import json
import os
import sys
import time
from types import SimpleNamespace

for _k in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SENTRY_DSN"):
    os.environ[_k] = ""
os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("TAVILY_API_KEY", "test")
os.environ["CORS_ORIGINS"] = "https://vettan.example"
os.environ["CORS_ORIGIN_REGEX"] = r"https://vettan-ai-[a-z0-9-]+\.vercel\.app"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from scripts import smoke  # noqa: E402

failures = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


API = "https://api.test"
SUPABASE = "https://sb.test"


def sse(*events):
    return "".join(f"event: {name}\ndata: {json.dumps(data)}\n\n" for name, data in events)


GOOD_RESEARCH = sse(
    ("stage", {"phase": "decomposed", "sub_queries": ["a", "b"]}),
    ("sources", {"citations": [{"url": "https://x.test"}]}),
    ("token", {"text": "Hello"}),
    ("done", {"session_id": "s1"}),
)
GOOD_FOLLOWUP = sse(("token", {"text": "Short."}), ("done", {"session_id": "s1"}))


def fake_backend(research=GOOD_RESEARCH, followup=GOOD_FOLLOWUP, commit="abc123", messages=4):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        calls.append((request.method, path))
        if path == "/health":
            return httpx.Response(200, json={"status": "healthy", "commit": commit})
        if path == "/auth/v1/token":
            return httpx.Response(200, json={"access_token": "tok"})
        if path == "/api/research/stream":
            body = json.loads(request.content)
            calls.append(("BODY", body))
            text = followup if body.get("is_followup") else research
            return httpx.Response(200, text=text, headers={"content-type": "text/event-stream"})
        if path == "/api/history":
            return httpx.Response(200, json={"sessions": [{"id": "s1"}]})
        if path == "/api/history/s1/messages":
            return httpx.Response(200, json={"count": messages})
        if request.method == "DELETE":
            return httpx.Response(200, json={"success": True})
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler)), calls


def run_smoke(client, commit="abc123"):
    report = []
    try:
        smoke.run(report, client, API, SUPABASE, "anon", "e@x.test", "pw", commit)
        return report, None
    except smoke.SmokeFailure as exc:
        return report, str(exc)


smoke.DEPLOY_WAIT_SECONDS = 0.5
smoke.time = SimpleNamespace(monotonic=time.monotonic, sleep=lambda _s: None)

print("\nSSE parsing")
events = smoke.parse_sse(["event: token", 'data: {"text": "a"}', "", 'data: {"x": 1}'])
check("named event", events[0] == ("token", {"text": "a"}), str(events))
check("default event name and trailing event without blank line", events[1] == ("message", {"x": 1}), str(events))

print("\nHappy path")
client, calls = fake_backend()
report, error = run_smoke(client)
check("passes", error is None, str(error))
check("reports every step", len(report) == 5, str(report))
check("research skips the stored-answer cache", ("BODY", {"query": smoke.QUESTION, "use_cache": False}) in calls)
check("reports the source count", any("1 sources" in line for line in report), str(report))
check("cleans up the conversation", ("DELETE", "/api/history/s1") in calls)

print("\nFailures")
client, _ = fake_backend(commit="old")
_, error = run_smoke(client)
check("old deploy never matches the expected commit", error and "commit abc123" in error, str(error))

client, _ = fake_backend(research=sse(("error", {"message": "boom"})))
_, error = run_smoke(client)
check("error event fails the run", error and "boom" in error, str(error))

client, _ = fake_backend(research=sse(("stage", {}), ("token", {"text": "x"}), ("done", {"session_id": "s1"})))
_, error = run_smoke(client)
check("missing sources fails the run", error and "no sources" in error, str(error))

client, calls = fake_backend(followup=sse(("blocked", {"message": "withheld"})))
report, error = run_smoke(client)
check("blocked follow-up fails the run", error and "withheld" in error, str(error))
check("conversation is still deleted after a failure", ("DELETE", "/api/history/s1") in calls)
check("steps before the failure stay in the report", any(line.startswith("research") for line in report), str(report))

client, _ = fake_backend(messages=2)
_, error = run_smoke(client)
check("unsaved messages fail the run", error and "found 2" in error, str(error))

print("\nSettings")
for name in ("API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SMOKE_EMAIL", "SMOKE_PASSWORD"):
    os.environ.pop(name, None)
check("missing settings exit 1", smoke.main() == 1)

print("\nBackend")
api = TestClient(main.app)
os.environ["RENDER_GIT_COMMIT"] = "abc123"
check("/health reports the deployed commit", api.get("/health").json().get("commit") == "abc123")
os.environ.pop("RENDER_GIT_COMMIT")
check("/health commit is null off Render", api.get("/health").json().get("commit") is None)


def preflight(origin):
    return api.options(
        "/api/history",
        headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
    ).headers.get("access-control-allow-origin")


check("listed origin allowed", preflight("https://vettan.example") == "https://vettan.example")
preview = "https://vettan-ai-git-main-someone.vercel.app"
check("preview origin allowed by the regex", preflight(preview) == preview)
check("other origins refused", preflight("https://evil.example") is None)
check("look-alike origin refused", preflight(preview + ".evil.example") is None)

print()
if failures:
    print(f"{len(failures)} FAILED: {failures}")
    sys.exit(1)
print("All smoke script tests passed")
