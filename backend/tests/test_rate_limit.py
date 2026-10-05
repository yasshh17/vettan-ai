"""
Rate limiter tests. No server or network needed:

    python tests/test_rate_limit.py

Key regressions: a 429 must keep its CORS headers, and X-Forwarded-For is read from the right.
"""
import os
import sys

# Set to "" rather than deleted: load_dotenv() on import would refill a missing key
# from backend/.env and connect to the real database.
for _k in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY"):
    os.environ[_k] = ""
os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("TAVILY_API_KEY", "test")

# Policies read the environment on import, so set these first.
os.environ["RATE_LIMIT_ENABLED"] = "true"
os.environ["RATE_LIMIT_TRUSTED_HOPS"] = "1"
os.environ["CORS_ORIGINS"] = "http://localhost:3000"
# Small enough that a handful of requests exhausts them.
os.environ["RATE_LIMIT_READ_CAPACITY"] = "3"
os.environ["RATE_LIMIT_READ_REFILL_PER_MIN"] = "60"
os.environ["RATE_LIMIT_RESEARCH_CAPACITY"] = "2"
# Slow refill, or a slow request refills its own cost and the bucket never depletes.
os.environ["RATE_LIMIT_RESEARCH_REFILL_PER_MIN"] = "1"
# Large so the IP layer never fires during section 3.
os.environ["RATE_LIMIT_IP_CAPACITY"] = "100000"
# No service-role key, so the spend guard would fail closed. See test_spend_guard.py.
os.environ["SPEND_GUARD_ENABLED"] = "false"
# The fake OpenAI key would otherwise send a real moderation call. See test_moderation.py.
os.environ["MODERATION_ENABLED"] = "false"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio  # noqa: E402

from utils import rate_limit  # noqa: E402
from utils.rate_limit import (  # noqa: E402
    BucketPolicy,
    InMemoryTokenBucketStore,
    client_ip,
)

failures = []
calls = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


class FakeClock:
    """Monotonic time under test control, so refill needs no sleeping."""

    def __init__(self, start=1000.0):
        self.t = start

    def __call__(self):
        return self.t

    def advance(self, seconds):
        self.t += seconds


_loop = asyncio.new_event_loop()


def consume(store, key, policy, cost=1.0):
    """Run the async consume() synchronously; it never awaits."""
    return _loop.run_until_complete(store.consume(key, policy, cost))


print("\n[1] Token bucket arithmetic")

# 10/min == one token every 6 seconds. Chosen so refill lands on whole numbers.
TEN_PER_MIN = BucketPolicy(name="research", capacity=10, refill_per_sec=10 / 60)

clock = FakeClock()
store = InMemoryTokenBucketStore(clock=clock)

d = consume(store, "k", TEN_PER_MIN)
check("a fresh key starts full", d.allowed and d.remaining == 9, str(d))

for _ in range(9):
    d = consume(store, "k", TEN_PER_MIN)
check("capacity consecutive requests all allowed", d.allowed and d.remaining == 0, str(d))

d = consume(store, "k", TEN_PER_MIN)
check("the next one is denied", not d.allowed, str(d))
check("  remaining is 0", d.remaining == 0, str(d))
check("  retry_after is exact (6s at 10/min)", d.retry_after == 6, str(d))
check("  limit reports capacity", d.limit == 10, str(d))

# A rejected request must not be charged, or a retrying client never recovers.
for _ in range(50):
    consume(store, "k", TEN_PER_MIN)
clock.advance(6.0)
d = consume(store, "k", TEN_PER_MIN)
check("a denied request is NOT charged (50 denials, then 1 token's wait)", d.allowed, str(d))

clock.advance(6.0)
d = consume(store, "k", TEN_PER_MIN)
check("refill is linear in elapsed time", d.allowed and d.remaining == 0, str(d))

clock.advance(86400)
d = consume(store, "k", TEN_PER_MIN)
check("refill clamps at capacity (a day's wait != a day's tokens)",
      d.remaining == 9, str(d))

# A clock that moves backwards must stall, not mint.
before = consume(store, "back", TEN_PER_MIN).remaining
clock.advance(-3600)
d = consume(store, "back", TEN_PER_MIN)
check("a backwards clock mints nothing", d.remaining <= before, str(d))
clock.advance(3600)

# Weighted cost: one bucket, different charge per endpoint.
store2 = InMemoryTokenBucketStore(clock=clock)
d = consume(store2, "w", TEN_PER_MIN, cost=4)
check("cost=4 draws 4 tokens", d.allowed and d.remaining == 6, str(d))
d = consume(store2, "w", TEN_PER_MIN, cost=11)
check("a cost above capacity is denied", not d.allowed, str(d))
d = consume(store2, "w", TEN_PER_MIN, cost=1)
check("  and did not drain the bucket", d.allowed and d.remaining == 5, str(d))

# Keys are independent, including across bucket classes for the same user.
store3 = InMemoryTokenBucketStore(clock=clock)
for _ in range(10):
    consume(store3, "research:alice", TEN_PER_MIN)
check("exhausting research:alice denies it",
      not consume(store3, "research:alice", TEN_PER_MIN).allowed)
check("  research:bob is untouched",
      consume(store3, "research:bob", TEN_PER_MIN).allowed)
check("  read:alice is untouched (class is part of the key)",
      consume(store3, "read:alice", TEN_PER_MIN).allowed)

# Eviction is lossless: a full bucket behaves the same as a missing one.
evict_clock = FakeClock()
evict_store = InMemoryTokenBucketStore(clock=evict_clock)
for i in range(600):
    consume(evict_store, f"key-{i}", TEN_PER_MIN)
before_sweep = evict_store.tracked_keys()
evict_clock.advance(TEN_PER_MIN.seconds_to_full + 1)
consume(evict_store, "trigger", TEN_PER_MIN)   # crosses the time-based cadence
after_sweep = evict_store.tracked_keys()
check("the sweep reclaims fully refilled keys",
      after_sweep < before_sweep, f"{before_sweep} -> {after_sweep}")
d = consume(evict_store, "key-0", TEN_PER_MIN)
check("  and a swept key still behaves as a full bucket",
      d.allowed and d.remaining == 9, str(d))

# Kill switch.
rate_limit.ENABLED = False
kill_store = InMemoryTokenBucketStore(clock=clock)
allowed_while_off = all(consume(kill_store, "off", TEN_PER_MIN).allowed for _ in range(50))
check("RATE_LIMIT_ENABLED=false allows everything", allowed_while_off)
check("  and never records a key", kill_store.tracked_keys() == 0)
rate_limit.ENABLED = True


print("\n[2] X-Forwarded-For handling")

CASES = [
    # (label, headers, peer, hops, expected)
    ("no XFF falls back to the socket peer", {}, "203.0.113.7", 1, "203.0.113.7"),
    ("single-entry XFF is used", {"x-forwarded-for": "203.0.113.7"}, "10.0.0.1", 1, "203.0.113.7"),
    # Regression: a client-supplied XFF is prepended to, so reading [0] is spoofable.
    ("REGRESSION: spoofed leftmost entry is ignored",
     {"x-forwarded-for": "1.2.3.4, 203.0.113.7"}, "10.0.0.1", 1, "203.0.113.7"),
    ("two trusted hops counts in from the right",
     {"x-forwarded-for": "1.2.3.4, 5.6.7.8, 203.0.113.7"}, "10.0.0.1", 2, "5.6.7.8"),
    ("hops=0 ignores XFF entirely (local dev)",
     {"x-forwarded-for": "203.0.113.7"}, "10.0.0.1", 0, "10.0.0.1"),
    ("garbage XFF falls back rather than becoming a key",
     {"x-forwarded-for": "not-an-ip"}, "10.0.0.1", 1, "10.0.0.1"),
    ("empty XFF falls back", {"x-forwarded-for": "   "}, "10.0.0.1", 1, "10.0.0.1"),
    ("a port on the peer is stripped", {}, "203.0.113.7:54321", 1, "203.0.113.7"),
    ("no peer and no XFF is 'unknown', not a crash", {}, None, 1, "unknown"),
]

for label, headers, peer, hops, expected in CASES:
    got = client_ip(headers, peer, hops)
    check(f"{label} -> {got}", got == expected, f"expected {expected}")

# IPv6 collapses to /64, or one user can rotate through their own addresses.
v6_a = client_ip({"x-forwarded-for": "2001:db8::1"}, None, 1)
v6_b = client_ip({"x-forwarded-for": "2001:db8::dead:beef"}, None, 1)
v6_c = client_ip({"x-forwarded-for": "2001:db8:1::1"}, None, 1)
check("IPv6 addresses in one /64 share a key", v6_a == v6_b, f"{v6_a} vs {v6_b}")
check("  but different /64s do not", v6_a != v6_c, f"{v6_a} vs {v6_c}")

_loop.close()


from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from utils.rate_limit_http import RateLimitMiddleware  # noqa: E402

ALICE = "11111111-1111-1111-1111-111111111111"
MALLORY = "99999999-9999-9999-9999-999999999999"
ORIGIN = {"Origin": "http://localhost:3000"}

client = TestClient(main.app, raise_server_exceptions=False)


class FakeDB:
    """Minimal stand-in; these tests care about status codes, not data."""

    is_connected = True
    schema_ready = True

    def check_schema(self):
        return True

    def get_recent_sessions(self, user_id, limit=10):
        calls.append(("get_recent_sessions", user_id, limit))
        return []

    def check_cache(self, query, user_id):
        return None


# Stub the pipeline and persistence so nothing reaches the network.
async def _fake_research(query, *args, **kwargs):
    return {"output": "stub answer " * 20, "citations": [], "metadata": {}}


main.research_complete = _fake_research
main._persist_new_session = lambda *a, **k: None


def as_user(uid):
    main.app.dependency_overrides[main.get_current_user] = \
        lambda: main.AuthedUser(id=uid, token="stub-token")


def reset_buckets():
    """Drop all bucket state between cases, so order doesn't matter."""
    main._rate_limit_store._state.clear()


main._db_for = lambda user: FakeDB()

print("\n[3] Per-user limits (read capacity 3)")

reset_buckets()
as_user(ALICE)

codes = [client.get("/api/history").status_code for _ in range(4)]
check(f"3 allowed then 429 -> {codes}", codes == [200, 200, 200, 429], str(codes))

r = client.get("/api/history")
body = r.json()
check("the body matches this codebase's {'detail': str} convention",
      list(body.keys()) == ["detail"] and isinstance(body["detail"], str), str(body))
check("  and names a wait", "Try again in" in body["detail"], body["detail"])
check("Retry-After is an integer >= 1",
      int(r.headers.get("Retry-After", 0)) >= 1, str(dict(r.headers)))
check("X-RateLimit-Limit reports capacity", r.headers.get("X-RateLimit-Limit") == "3",
      str(r.headers.get("X-RateLimit-Limit")))
check("X-RateLimit-Remaining is 0", r.headers.get("X-RateLimit-Remaining") == "0",
      str(r.headers.get("X-RateLimit-Remaining")))
check("X-RateLimit-Reset parses as an int",
      r.headers.get("X-RateLimit-Reset", "").isdigit(), str(r.headers.get("X-RateLimit-Reset")))

# Success headers are set by the middleware because FastAPI skips the header
# merge when a handler returns a Response directly (the SSE endpoint does).
reset_buckets()
first = client.get("/api/history")
second = client.get("/api/history")
check("a 200 also carries X-RateLimit-Remaining",
      "x-ratelimit-remaining" in {k.lower() for k in first.headers}, str(dict(first.headers)))
check("  and it decrements",
      int(first.headers["X-RateLimit-Remaining"]) > int(second.headers["X-RateLimit-Remaining"]),
      f"{first.headers.get('X-RateLimit-Remaining')} -> {second.headers.get('X-RateLimit-Remaining')}")

# Keyed on the authenticated id, not the connection.
reset_buckets()
as_user(ALICE)
for _ in range(4):
    client.get("/api/history")
as_user(MALLORY)
check("another user is unaffected by ALICE's exhaustion",
      client.get("/api/history").status_code == 200)

# Middleware-ordering regression: only the IP layer's own 429 can escape CORS,
# so shrink the live middleware's capacity for this case.
def _find_middleware(app, cls):
    node = app.middleware_stack
    while node is not None:
        if isinstance(node, cls):
            return node
        node = getattr(node, "app", None)
    return None


ip_mw = _find_middleware(main.app, RateLimitMiddleware)
check("the rate limit middleware is installed", ip_mw is not None)

if ip_mw is not None:
    original_policy = ip_mw.policy
    ip_mw.policy = BucketPolicy(name="ip", capacity=2, refill_per_sec=1 / 60)
    reset_buckets()
    as_user(ALICE)

    codes = [client.get("/api/history", headers=ORIGIN).status_code for _ in range(3)]
    r = client.get("/api/history", headers=ORIGIN)
    check(f"the IP layer rejects once its bucket is empty -> {codes}",
          r.status_code == 429, str(codes))
    check("  and the rejection came from the middleware, not the read bucket",
          r.headers.get("X-RateLimit-Limit") == "2", str(r.headers.get("X-RateLimit-Limit")))
    check("REGRESSION: a middleware 429 still carries Access-Control-Allow-Origin",
          "access-control-allow-origin" in {k.lower() for k in r.headers},
          "RateLimitMiddleware must be registered BEFORE CORSMiddleware in main.py, "
          "so that CORS ends up wrapping it")

    ip_mw.policy = original_policy

# A dependency-level 429 keeps its CORS headers too.
reset_buckets()
as_user(ALICE)
for _ in range(4):
    client.get("/api/history", headers=ORIGIN)
r = client.get("/api/history", headers=ORIGIN)
check("a dependency 429 is still a 429", r.status_code == 429, str(r.status_code))
check("  and also carries Access-Control-Allow-Origin",
      "access-control-allow-origin" in {k.lower() for k in r.headers})

# Preflights must never be metered: the browser sends one per request.
reset_buckets()
as_user(ALICE)
for _ in range(4):
    client.get("/api/history")
opts = client.options(
    "/api/history",
    headers={**ORIGIN, "Access-Control-Request-Method": "GET"},
)
check(f"OPTIONS preflight is answered even when the bucket is empty -> {opts.status_code}",
      opts.status_code in (200, 204), str(opts.status_code))

# Uptime checks must never be throttled.
reset_buckets()
as_user(ALICE)
for _ in range(10):
    client.get("/api/history")
check("/health is exempt", client.get("/health").status_code == 200)
check("/ is exempt", client.get("/").status_code == 200)

# A 401 costs an IP token, never a user token — the user is not known yet.
reset_buckets()
main.app.dependency_overrides.clear()
unauth = [client.get("/api/history").status_code for _ in range(10)]
check(f"10 unauthenticated calls are all 401, not 429 -> {set(unauth)}",
      set(unauth) == {401}, str(unauth))
as_user(ALICE)
check("  and the user's bucket is untouched afterwards",
      client.get("/api/history").status_code == 200)

# research and research/stream share one bucket, and the 429 lands before the stream opens.
reset_buckets()
as_user(ALICE)
r1 = client.post("/api/research", json={"query": "hi"})
r2 = client.post("/api/research", json={"query": "hi"})
r3 = client.post("/api/research/stream", json={"query": "hi"})
check(f"/api/research/stream shares the research bucket -> {r3.status_code}",
      r3.status_code == 429, f"{r1.status_code}, {r2.status_code}, {r3.status_code}")
check("  and the 429 is JSON, not an SSE stream carrying an error frame",
      r3.headers.get("content-type", "").startswith("application/json"),
      str(r3.headers.get("content-type")))

main.app.dependency_overrides.clear()


print("\n[4] Pre-auth IP middleware (capacity 2)")


async def stub_app(scope, receive, send):
    await send({"type": "http.response.start", "status": 200,
                "headers": [(b"content-type", b"text/plain")]})
    await send({"type": "http.response.body", "body": b"ok"})


IP_POLICY = BucketPolicy(name="ip", capacity=2, refill_per_sec=1 / 60)


def ip_client():
    return TestClient(
        RateLimitMiddleware(
            stub_app,
            store=InMemoryTokenBucketStore(),
            policy=IP_POLICY,
            trusted_hops=1,
            exempt_paths=("/", "/health"),
        )
    )


def xff(ip):
    return {"x-forwarded-for": ip}


c = ip_client()
codes = [c.get("/api/history", headers=xff("203.0.113.7")).status_code for _ in range(3)]
check(f"2 allowed then 429 -> {codes}", codes == [200, 200, 429], str(codes))

r = c.get("/api/history", headers=xff("203.0.113.7"))
check("the middleware's 429 is JSON with a detail string",
      r.status_code == 429 and isinstance(r.json().get("detail"), str), r.text[:120])
check("  with Retry-After", int(r.headers.get("Retry-After", 0)) >= 1, str(dict(r.headers)))
check("  and X-RateLimit-Limit", r.headers.get("X-RateLimit-Limit") == "2",
      str(r.headers.get("X-RateLimit-Limit")))
check("a different address gets its own bucket",
      c.get("/api/history", headers=xff("198.51.100.4")).status_code == 200)

# Regression: keyed on the rightmost entry (exhausted), not the spoofed 9.9.9.9.
r = c.get("/api/history", headers=xff("9.9.9.9, 203.0.113.7"))
check(f"REGRESSION: a spoofed leftmost XFF cannot mint a fresh bucket -> {r.status_code}",
      r.status_code == 429, "client-supplied XFF prefix must be ignored")

c = ip_client()
for _ in range(3):
    c.get("/x", headers=xff("203.0.113.7"))
opts = [c.options("/x", headers=xff("203.0.113.7")).status_code for _ in range(10)]
check(f"OPTIONS is never metered -> {set(opts)}", set(opts) == {200}, str(opts))
check("/health stays exempt at the IP layer",
      c.get("/health", headers=xff("203.0.113.7")).status_code == 200)
check("/ stays exempt at the IP layer",
      c.get("/", headers=xff("203.0.113.7")).status_code == 200)

c = ip_client()
check("a successful response carries X-RateLimit-Remaining",
      c.get("/x", headers=xff("203.0.113.7")).headers.get("X-RateLimit-Remaining") == "1")

rate_limit.ENABLED = False
c = ip_client()
off = [c.get("/x", headers=xff("203.0.113.7")).status_code for _ in range(10)]
check(f"RATE_LIMIT_ENABLED=false bypasses the middleware -> {set(off)}", set(off) == {200})
rate_limit.ENABLED = True


from utils.rate_limit import ConcurrencySlots  # noqa: E402

print("\n[5] Concurrency slots")

slots = ConcurrencySlots(per_key=2, total=3)
check("the first acquire succeeds", slots.try_acquire("alice"))
check("the second succeeds", slots.try_acquire("alice"))
check("the third is refused (per-user cap)", not slots.try_acquire("alice"))
check("another user still gets a slot", slots.try_acquire("bob"))
check("  but the global cap then bites", not slots.try_acquire("carol"))

slots.release("alice")
check("releasing frees a slot", slots.try_acquire("alice"))
slots.release("alice")
slots.release("alice")
slots.release("bob")
check("everything is handed back", slots.in_flight() == 0, str(slots.in_flight()))

# Over-releasing must not drive the counter negative and raise the cap.
slots.release("nobody")
check("an unmatched release does not go negative", slots.in_flight() == 0, str(slots.in_flight()))
check("  and capacity is unchanged", slots.try_acquire("dave") and slots.in_flight() == 1)
slots.release("dave")

# Over HTTP: the cap rejects with 429 rather than queueing.
reset_buckets()
as_user(ALICE)
saturated = ConcurrencySlots(per_key=0, total=0)
original_slots = main._research_slots
main._research_slots = saturated
r = client.post("/api/research", json={"query": "hi"})
check(f"a saturated slot pool returns 429, not a hang -> {r.status_code}",
      r.status_code == 429, str(r.status_code))
check("  with an explanatory detail", "in progress" in r.json().get("detail", ""),
      str(r.json())[:120])
main._research_slots = original_slots

reset_buckets()
r = client.post("/api/research", json={"query": "hi"})
check("slots are released after a completed request",
      r.status_code == 200 and main._research_slots.in_flight() == 0,
      f"{r.status_code}, in_flight={main._research_slots.in_flight()}")

main.app.dependency_overrides.clear()


print("\n" + "=" * 60)
if failures:
    print(f"FAILED ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("All rate limiter checks passed.")
