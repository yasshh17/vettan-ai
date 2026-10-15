"""
Sentry error tracking tests. No network needed; events are captured in memory:

    python tests/test_observability.py
"""
import os
import sys

# Set before importing main, like test_rate_limit.py.
for _k in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "REDIS_URL", "SENTRY_DSN"):
    os.environ[_k] = ""
os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("TAVILY_API_KEY", "test")
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["AUDIT_IP_SALT"] = "test-salt"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json  # noqa: E402
import logging  # noqa: E402

import sentry_sdk  # noqa: E402
from sentry_sdk.transport import Transport  # noqa: E402

from utils import observability  # noqa: E402

failures = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


MARKER = "MARKER-7f3a"  # stands in for user text
ALICE = "11111111-1111-1111-1111-111111111111"
CLIENT_IP = "203.0.113.9"


print("Without SENTRY_DSN")
check("init_sentry() reports off", observability.init_sentry() is False)
check("is_enabled() is false", observability.is_enabled() is False)
check("Sentry client is inactive", not sentry_sdk.get_client().is_active())
observability.capture(RuntimeError(MARKER))
observability.alert("test")
observability.set_user(ALICE)
check("capture/alert/set_user are no-ops", True)


print("\nscrub_event")
event = {
    "request": {
        "url": f"https://api.example.com/api/history?q={MARKER}",
        "query_string": f"q={MARKER}",
        "data": {"query": MARKER},
        "cookies": {"sb": MARKER},
        "env": {"REMOTE_ADDR": CLIENT_IP},
        "headers": {
            "Authorization": f"Bearer {MARKER}",
            "Cookie": MARKER,
            "X-Forwarded-For": CLIENT_IP,
            "User-Agent": "test-agent",
        },
    },
    "exception": {"values": [{"type": "ValueError", "value": f"bad input: {MARKER}"}]},
    "user": {"id": "abc", "ip_address": CLIENT_IP, "email": "a@example.com"},
    "breadcrumbs": {"values": [
        {"category": "log", "message": f"REQUEST: {MARKER}"},
        {"category": "httplib", "data": {"url": f"https://db.example.com/rest/v1/s?title=ilike.{MARKER}",
                                         "http.query": f"title=ilike.{MARKER}"}},
    ]},
    "spans": [{"description": f"GET https://db.example.com/rest/v1/s?q={MARKER}",
               "data": {"url": f"https://db.example.com/rest/v1/s?q={MARKER}"}}],
}
scrubbed = observability.scrub_event(event)
dump = json.dumps(scrubbed)
check("no marker survives", MARKER not in dump, dump)
check("no client IP survives", CLIENT_IP not in dump, dump)
check("no email survives", "a@example.com" not in dump, dump)
check("user agent is kept", scrubbed["request"]["headers"].get("User-Agent") == "test-agent")
check("exception type is kept", scrubbed["exception"]["values"][0]["type"] == "ValueError")
check("user keeps only its id", scrubbed["user"] == {"id": "abc"})
check("log breadcrumbs are dropped", all(c.get("category") != "log" for c in scrubbed["breadcrumbs"]["values"]))
check("http breadcrumb keeps its path",
      scrubbed["breadcrumbs"]["values"][0]["data"]["url"] == "https://db.example.com/rest/v1/s")
check("span keeps method and path", scrubbed["spans"][0]["description"] == "GET https://db.example.com/rest/v1/s")
check("hash_user is stable and not the raw id",
      observability.hash_user(ALICE) == observability.hash_user(ALICE) and ALICE not in observability.hash_user(ALICE))


print("\nEnd to end through the app")


class Capture(Transport):
    def __init__(self):
        super().__init__()
        self.envelopes = []

    def capture_envelope(self, envelope):
        self.envelopes.append(envelope)

    def items(self, kind):
        return [i.payload.json for e in self.envelopes for i in e.items if i.type == kind]


os.environ["SENTRY_DSN"] = "https://public@o0.ingest.sentry.io/0"
os.environ["SENTRY_TRACES_SAMPLE_RATE"] = "1.0"

import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

check("main turned Sentry on", observability.is_enabled())
transport = Capture()
sentry_sdk.get_client().transport = transport


class BrokenDB:
    is_connected = True
    schema_ready = True

    def get_recent_sessions(self, user_id, limit=50):
        raise RuntimeError(f"database said: {MARKER}")


main._verify_access_token = lambda authorization: main.AuthedUser(id=ALICE, token=MARKER)
main._db_for = lambda user: BrokenDB()
client = TestClient(main.app)

logging.getLogger("main").info(f"REQUEST: {MARKER}")
r = client.get(
    f"/api/history?limit=5&q={MARKER}",
    headers={"Authorization": f"Bearer {MARKER}", "Cookie": f"sb={MARKER}", "X-Forwarded-For": CLIENT_IP},
)
sentry_sdk.flush()
events = transport.items("event")
check(f"history failure returns 500 -> {r.status_code}", r.status_code == 500)
check(f"exactly one event is reported -> {len(events)}", len(events) == 1)
if events:
    ev = events[0]
    exc = ev["exception"]["values"][-1]
    check("event names the exception type", exc.get("type") == "RuntimeError")
    check("event has a stack trace", bool((exc.get("stacktrace") or {}).get("frames")))
    check("event is tagged with the hashed user", ev.get("user") == {"id": observability.hash_user(ALICE)})
    check("event has the route", ev["request"]["url"].endswith("/api/history"))

check("the request was traced", len(transport.items("transaction")) == 1)
everything = json.dumps(events + transport.items("transaction"))
check("no marker in anything sent", MARKER not in everything)
check("no client IP in anything sent", CLIENT_IP not in everything)
check("no raw user id in anything sent", ALICE not in everything)

transport.envelopes.clear()
r = client.get("/health")
sentry_sdk.flush()
check(f"/health is not traced -> {len(transport.items('transaction'))}", transport.items("transaction") == [])

transport.envelopes.clear()
main.spend_guard._alerted_day = None
main.spend_guard._maybe_alert(main.spend_guard.to_micros(main.spend_guard.GLOBAL_DAILY_BUDGET_USD))
sentry_sdk.flush()
alerts = transport.items("event")
check("global spend alert is reported", len(alerts) == 1 and alerts[0].get("level") == "error")

print()
print("=" * 60)
if failures:
    print(f"{len(failures)} observability check(s) FAILED:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("All observability checks passed.")
