"""
A follow-up must reach the model once, after the earlier conversation. No network
needed: the OpenAI client is faked and records what it is sent.

    python tests/test_followup_context.py
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

import json  # noqa: E402
from types import SimpleNamespace as NS  # noqa: E402

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from agent import research_pipeline as rp  # noqa: E402

failures = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


USER = "11111111-1111-1111-1111-111111111111"
SESSION = "33333333-3333-3333-3333-333333333333"
QUESTION = "and what about Norway?"

# Eight earlier messages, so the six-message window has something to cut.
HISTORY = [
    {"id": f"m{i}", "role": "user" if i % 2 == 0 else "assistant", "content": f"earlier message {i}",
     "citations": [], "metadata": {}, "created_at": f"2026-10-0{i + 1}T00:00:00+00:00"}
    for i in range(8)
]

sent = []
persisted = []


class FakeStream:
    def __init__(self):
        self.chunks = [
            NS(choices=[NS(delta=NS(content="Norway too."))], usage=None),
            NS(choices=[], usage=NS(prompt_tokens=10, completion_tokens=5)),
        ]

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for chunk in self.chunks:
            yield chunk

    async def close(self):
        pass


class FakeCompletions:
    async def create(self, **kw):
        sent.append(kw["messages"])
        if kw.get("stream"):
            return FakeStream()
        return NS(choices=[NS(message=NS(content="Norway too."))], usage=NS(prompt_tokens=10, completion_tokens=5))


class FakeDB:
    is_connected = True
    schema_ready = True

    def get_conversation_history(self, session_id, user_id):
        return [dict(m) for m in HISTORY]


rp.openai_client = NS(chat=NS(completions=FakeCompletions()))
main._db_for = lambda user: FakeDB()
main._persist_followup = lambda db, session_id, messages, user_id: persisted.append(messages)
main.app.dependency_overrides[main.get_current_user] = lambda: main.AuthedUser(id=USER, token="stub")

client = TestClient(main.app, raise_server_exceptions=False)
FOLLOWUP = {"query": QUESTION, "session_id": SESSION, "is_followup": True}


def check_prompt(label, messages):
    contents = [m["content"] for m in messages]
    check(f"{label}: the question is sent once", contents.count(QUESTION) == 1, str(contents))
    check(f"{label}: the question is the last message",
          messages[-1] == {"role": "user", "content": QUESTION}, str(messages[-1]))
    earlier = [{"role": m["role"], "content": m["content"]} for m in HISTORY[-6:]]
    check(f"{label}: the six earlier messages come before it",
          messages[1:-1] == earlier, str(contents[1:-1]))


def check_saved(label):
    saved = persisted[-1] if persisted else []
    check(f"{label}: the question and answer are still saved",
          len(saved) == 2 and saved[0]["role"] == "user" and saved[0]["content"] == QUESTION, str(saved)[:200])
    return saved


print("\n[1] Follow-up, non-streaming")
sent.clear()
persisted.clear()
r = client.post("/api/research", json=FOLLOWUP)
check("POST /api/research follow-up: 200", r.status_code == 200, f"{r.status_code} {r.text[:120]}")
check("one model call", len(sent) == 1, str(len(sent)))
if sent:
    check_prompt("sync", sent[-1])
check_saved("sync")
check("response returns the full conversation", r.status_code == 200 and len(r.json()["messages"]) == 10,
      str(r.json().get("messages", ""))[:120] if r.status_code == 200 else r.text[:120])


print("\n[2] Follow-up, streaming")
sent.clear()
persisted.clear()
r = client.post("/api/research/stream", json=FOLLOWUP)
check("POST /api/research/stream follow-up: 200", r.status_code == 200, f"{r.status_code} {r.text[:120]}")
check("stream finishes with done", "event: done" in r.text, r.text[-200:])
check("one model call", len(sent) == 1, str(len(sent)))
if sent:
    check_prompt("stream", sent[-1])
saved = check_saved("stream")
done = next((json.loads(f.split("data: ", 1)[1]) for f in r.text.strip().split("\n\n") if f.startswith("event: done")), {})
check("done carries the saved question's id",
      bool(saved) and done.get("user_message_id") == saved[0]["id"], f"{done.get('user_message_id')}")

main.app.dependency_overrides.clear()


print("\n" + "=" * 60)
if failures:
    print(f"FAILED ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("All follow-up context checks passed.")
