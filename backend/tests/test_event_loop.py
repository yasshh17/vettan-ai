"""
Blocking calls must not run on the event loop. Production runs one worker, so a
sync database or TTS call made in an async handler stalls every other request,
including live research streams. No network needed:

    python tests/test_event_loop.py

Each fake blocking call waits for a signal that only a coroutine on the loop can
send. If the call runs on the loop itself, that coroutine can't run, the wait
times out and the check fails. No timing thresholds involved.
"""
import os
import sys

# Set before importing main. Blank rather than unset, or load_dotenv() refills them.
for _k in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SENTRY_DSN"):
    os.environ[_k] = ""
os.environ["OPENAI_API_KEY"] = "test"
os.environ["TAVILY_API_KEY"] = "test"
for _k in ("RATE_LIMIT_ENABLED", "SPEND_GUARD_ENABLED", "MODERATION_ENABLED", "ANALYTICS_ENABLED"):
    os.environ[_k] = "false"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio  # noqa: E402
import threading  # noqa: E402
from types import SimpleNamespace as NS  # noqa: E402

import httpx  # noqa: E402

import main  # noqa: E402

failures = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


USER = "11111111-1111-1111-1111-111111111111"
waiting = []
results = []


def blocking_call():
    """Stands in for a sync network call: returns once the loop signals it."""
    ev = threading.Event()
    waiting.append(ev)
    results.append((ev.wait(2.0), threading.current_thread().name))


class FakeDB:
    is_connected = True

    def __init__(self, schema_ready=True):
        self.schema_ready = schema_ready

    def check_schema(self):
        blocking_call()
        return True

    def get_recent_sessions(self, user_id, limit=50):
        blocking_call()
        return [{"id": "s1", "query": "q", "created_at": "x"}]

    def get_session_by_id(self, session_id, user_id):
        blocking_call()
        return {"id": session_id, "report": "r", "citations": [], "metadata": {}}

    def get_conversation_history(self, session_id, user_id):
        blocking_call()
        return [{"id": "m1", "role": "user", "content": "q", "created_at": "x"}]

    def update_session(self, session_id, data, user_id):
        blocking_call()
        return True

    def delete_session(self, session_id, user_id):
        blocking_call()
        return True


class SlowTTS:
    def prepare_text_for_speech(self, text):
        return text

    def generate_audio(self, text, voice):
        blocking_call()
        return b"mp3"

    def estimate_cost(self, text):
        return 0.0


class FakeAdminClient:
    def __init__(self):
        self.auth = NS(admin=NS(delete_user=lambda user_id: blocking_call()))


db = FakeDB()
main._db_for = lambda user: db
main.get_tts = lambda: SlowTTS()
main.get_admin_client = lambda: FakeAdminClient()
main._password_matches = lambda user_id, password: True
main.app.dependency_overrides[main.get_current_user] = lambda: main.AuthedUser(id=USER, token="stub")


async def _request(method, path, **kwargs):
    async def ticker():
        while True:
            for ev in list(waiting):
                ev.set()
            await asyncio.sleep(0.005)

    tick = asyncio.create_task(ticker())
    try:
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            return await client.request(method, path, **kwargs)
    finally:
        tick.cancel()


def run(label, method, path, expected_calls, status=200, **kwargs):
    waiting.clear()
    results.clear()
    response = asyncio.run(_request(method, path, **kwargs))
    check(f"{label}: {status}", response.status_code == status, f"{response.status_code} {response.text[:120]}")
    check(f"{label}: {expected_calls} blocking call(s) made", len(results) == expected_calls, str(results))
    check(f"{label}: none ran on the event loop", all(ok for ok, _ in results), str(results))
    return list(results)


print("\n[1] History")
run("GET /api/history", "GET", "/api/history", 1)
run("GET /api/history/{id}", "GET", "/api/history/s1", 2)
run("GET /api/history/{id}/messages", "GET", "/api/history/s1/messages", 1)
run("PATCH /api/history/{id}", "PATCH", "/api/history/s1", 1, json={"title": "renamed"})
run("DELETE /api/history/{id}", "DELETE", "/api/history/s1", 1)

print("\n[2] Text-to-speech")
calls = run("POST /api/audio", "POST", "/api/audio", 1, json={"text": "hello there"})
# Its own pool: a long TTS job mustn't hold the default executor that auth also uses.
check("TTS runs on the dedicated tts pool", bool(calls) and calls[0][1].startswith("tts"), str(calls))

print("\n[3] Account deletion")
run("DELETE /api/account", "DELETE", "/api/account", 1, json={"password": "pw"})

print("\n[4] Schema re-probe (only when the startup check failed)")
db.schema_ready = False
run("GET /api/history, schema not ready", "GET", "/api/history", 2)
main.get_database_v2 = lambda: FakeDB(schema_ready=False)
run("GET /health, schema not ready", "GET", "/health", 1)

main.app.dependency_overrides.clear()


print("\n" + "=" * 60)
if failures:
    print(f"FAILED ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("All event loop checks passed.")
