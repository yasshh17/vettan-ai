"""
Security audit log tests. No network needed:

    python tests/test_audit.py
"""
import os
import sys

# Set before importing main (see test_rate_limit.py).
for _k in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "REDIS_URL"):
    os.environ[_k] = ""
os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("TAVILY_API_KEY", "test")
os.environ["RATE_LIMIT_ENABLED"] = "true"
os.environ["RATE_LIMIT_TRUSTED_HOPS"] = "0"
os.environ["SPEND_GUARD_ENABLED"] = "true"
os.environ["MODERATION_ENABLED"] = "true"
os.environ["AUDIT_IP_SALT"] = "test-salt"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio  # noqa: E402
import logging  # noqa: E402

from fastapi import Depends, FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from utils import audit, moderation, spend_guard  # noqa: E402
from utils.rate_limit import BucketPolicy, InMemoryTokenBucketStore  # noqa: E402
from utils.rate_limit_http import RateLimitMiddleware, rate_limited  # noqa: E402
from utils.spend_guard import InMemorySpendStore  # noqa: E402

import main  # noqa: E402

failures = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


rows = []


class Capture(logging.Handler):
    def emit(self, record):
        event = getattr(record, "security_event", None)
        if event is not None:
            rows.append({**event, "line": record.getMessage(), "level": record.levelno})


logging.getLogger("utils.audit").addHandler(Capture())


def events(name=None):
    return [r for r in rows if name is None or r["event"] == name]


def reset():
    rows.clear()


ALICE = "11111111-1111-1111-1111-111111111111"

print("\n[record()]")

reset()
audit.record("not_a_real_event", user_id=ALICE)
check("unknown event names are rejected, not logged", events() == [])

audit.record("spend_cap_hit", user_id=ALICE, kind="research", scope="user")
got = events()
check("a valid event is one [Security] warning with its fields",
      len(got) == 1 and got[0]["line"].startswith("[Security] event=spend_cap_hit")
      and got[0]["user"] == ALICE[:8] and got[0]["kind"] == "research"
      and got[0]["level"] == logging.WARNING, repr(got))

h = audit.hash_ip("203.0.113.7")
check("IPs are hashed: stable, salted, never the raw address",
      h == audit.hash_ip("203.0.113.7") and "203.0.113.7" not in h and len(h) == 16
      and audit.hash_ip(None) is None)

access = logging.LogRecord("uvicorn.access", logging.INFO, "", 0,
                           '%s - "%s %s HTTP/%s" %d', ("203.0.113.7:51234", "GET", "/api/history", "1.1", 401), None)
audit.RedactClientIP().filter(access)
line = access.getMessage()
check("access log lines carry the hashed IP, not the raw one",
      line == f'ip={audit.hash_ip("203.0.113.7")} - "GET /api/history HTTP/1.1" 401' and "203.0.113.7" not in line, line)

ipv6 = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s"', ("2001:db8::1:443", "GET"), None)
audit.RedactClientIP().filter(ipv6)
check("an IPv6 client is hashed without its port", ipv6.getMessage() == f'ip={audit.hash_ip("2001:db8::1")} - "GET"', ipv6.getMessage())

other = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, "plain message", None, None)
check("lines without arguments pass through untouched",
      audit.RedactClientIP().filter(other) and other.getMessage() == "plain message")

print("\n[rate limits]")

app = FastAPI()
store = InMemoryTokenBucketStore()
tiny = BucketPolicy(name="ip", capacity=1, refill_per_sec=0.0001)
app.add_middleware(RateLimitMiddleware, store=store, policy=tiny, trusted_hops=1, exempt_paths=())


async def fake_user():
    return main.AuthedUser(id=ALICE, token="t")


limited_user = rate_limited("account", fake_user, InMemoryTokenBucketStore())


@app.get("/open")
async def open_route():
    return {"ok": True}


@app.get("/mine")
async def mine(user=Depends(limited_user)):
    return {"ok": True}


small = TestClient(app, headers={"X-Forwarded-For": "203.0.113.7"})
reset()
codes = [small.get("/open").status_code for _ in range(2)]
got = events("rate_limited")
check(f"per-IP 429 is logged once -> {codes}",
      codes == [200, 429] and len(got) == 1 and got[0]["bucket"] == "ip"
      and got[0]["path"] == "/open" and got[0]["user"] == "-")
check("  with a hashed IP, never the raw one",
      got and got[0]["ip"] == audit.hash_ip("203.0.113.7") and "203.0.113.7" not in got[0]["line"])

user_app = FastAPI()
user_app.get("/mine")(mine)
reset()
codes = [TestClient(user_app).get("/mine").status_code for _ in range(5)]
got = events("rate_limited")
check(f"per-user 429s are recorded with the user id and bucket -> {codes}",
      codes == [200, 200, 200, 429, 429] and len(got) == 2
      and all(r["user"] == ALICE[:8] and r["bucket"] == "account" for r in got),
      repr(got))

print("\n[auth]")

client = TestClient(main.app, raise_server_exceptions=False)
reset()
r = client.get("/api/history")
got = events("auth_failed")
check(f"a missing token is a 401 and one auth_failed event -> {r.status_code}",
      r.status_code == 401 and len(got) == 1 and got[0]["path"] == "/api/history"
      and got[0]["ip"] != "-")


print("\n[moderation]")


async def flagged(text):
    return moderation.Scores(flagged=frozenset({"illicit/violent"}), scores={"illicit/violent": 0.99})


real_moderate = moderation._moderate
moderation._moderate = flagged
reset()
verdict = asyncio.run(moderation.check("SECRET QUERY TEXT", "output", ALICE))
got = events("moderation_blocked")
check("a moderation block is recorded with source and categories",
      verdict.flagged and len(got) == 1 and got[0]["source"] == "output"
      and got[0]["categories"] == verdict.categories, repr(got))
check("  and the moderated text is never stored", "SECRET QUERY TEXT" not in repr(rows))


async def down(text):
    raise RuntimeError("moderation API down")


moderation._moderate = down
reset()
asyncio.run(moderation.check("SECRET QUERY TEXT", "input", ALICE))
asyncio.run(moderation.check("SECRET QUERY TEXT", "output", ALICE))
got = events("moderation_unavailable")
check("moderation outages are logged with the source and what happened",
      [(g["source"], g["action"]) for g in got] == [("input", "refused"), ("output", "allowed")]
      and "SECRET QUERY TEXT" not in repr(rows), repr(got))
moderation._moderate = real_moderate

print("\n[spend]")

old_user, old_global = spend_guard.USER_DAILY_BUDGET_USD, spend_guard.GLOBAL_DAILY_BUDGET_USD
spend_guard.USER_DAILY_BUDGET_USD, spend_guard.GLOBAL_DAILY_BUDGET_USD = 0.001, 100.0
reset()
try:
    asyncio.run(spend_guard.charge(InMemorySpendStore(), ALICE, "research", 0.01))
    status = 200
except HTTPException as e:
    status = e.status_code
got = events("spend_cap_hit")
check(f"a user over budget is recorded as spend_cap_hit -> {status}",
      status == 429 and len(got) == 1 and got[0]["kind"] == "research" and got[0]["scope"] == "user",
      repr(got))

spend_guard._alerted_day = None
reset()
spend_guard._maybe_alert(spend_guard.to_micros(95.0))
spend_guard._maybe_alert(spend_guard.to_micros(96.0))
got = events("spend_alert")
check("the global spend alert is recorded once per day",
      len(got) == 1 and got[0]["budget_usd"] == 100.0, repr(got))
spend_guard.USER_DAILY_BUDGET_USD, spend_guard.GLOBAL_DAILY_BUDGET_USD = old_user, old_global

print("\n[endpoints]")

# The fake OpenAI key would otherwise send a real moderation call.
moderation.ENABLED = False

main.app.dependency_overrides[main.get_current_user] = lambda: main.AuthedUser(id=ALICE, token="t")


async def no_slot(key):
    return False


real_acquire = main._research_slots.try_acquire
main._research_slots.try_acquire = no_slot
reset()
r1 = client.post("/api/research", json={"query": "q"})
r2 = client.post("/api/research/stream", json={"query": "q"})
got = events("inflight_rejected")
check(f"in-flight rejections are recorded on both research endpoints -> {r1.status_code}, {r2.status_code}",
      r1.status_code == 429 and r2.status_code == 429 and len(got) == 2
      and all(g["user"] == ALICE[:8] for g in got), repr(got))
main._research_slots.try_acquire = real_acquire


class FakeAdmin:
    class auth:
        class admin:
            @staticmethod
            def delete_user(user_id):
                return None


main.get_admin_client = lambda: FakeAdmin()
reset()
r = client.delete("/api/account")
got = events("account_deleted")
check(f"account deletion is recorded -> {r.status_code}",
      r.status_code == 200 and len(got) == 1 and got[0]["user"] == ALICE[:8])

main.app.dependency_overrides.clear()

print()
print("=" * 60)
if failures:
    print(f"{len(failures)} audit check(s) FAILED:")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("All audit checks passed.")
