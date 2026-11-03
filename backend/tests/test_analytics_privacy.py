"""
Coded IDs, consent, erasure, retries and monitoring. Runs offline: the RPCs are
faked here and exercised on a real Postgres in test_analytics_sql.py.

    python tests/test_analytics_privacy.py
"""
import logging
import os
import sys

for _k in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "ANALYTICS_ADMIN_USER_IDS",
           "PURGE_HEALTH_TOKEN", "PURGE_HEALTH_TOKEN_PREVIOUS"):
    os.environ[_k] = ""
os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("TAVILY_API_KEY", "test")
os.environ["RATE_LIMIT_ENABLED"] = "false"
os.environ["SPEND_GUARD_ENABLED"] = "false"
os.environ["MODERATION_ENABLED"] = "false"
os.environ["ANALYTICS_ENABLED"] = "true"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timedelta, timezone  # noqa: E402
from types import SimpleNamespace as NS  # noqa: E402

from fastapi import HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from tests.analytics_fakes import FakeAdminClient, FakePrivacyStore  # noqa: E402
from utils import analytics, analytics_keys, analytics_privacy, moderation, observability, spend_guard  # noqa: E402

failures = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + str(detail) if detail and not cond else ''}")
    if not cond:
        failures.append(label)


ALICE = "11111111-1111-1111-1111-111111111111"
BOB = "22222222-2222-2222-2222-222222222222"
ID_SECRET = "i" * 64
AUDIT_SECRET = "z" * 64
HEALTH_TOKEN = "t" * 40
PASSWORD = "correct horse"

os.environ["ANALYTICS_ID_SECRET"] = ID_SECRET
os.environ["ANALYTICS_AUDIT_LOG_SECRET"] = AUDIT_SECRET


def fresh():
    store = FakePrivacyStore()
    analytics_privacy.store = store
    analytics_privacy._alerted.clear()
    admin = FakeAdminClient(store)
    main.get_admin_client = lambda: admin
    analytics_privacy.admin_client = lambda: admin
    return store, admin.auth.admin


def as_user(user_id):
    main.app.dependency_overrides[main.get_current_user] = \
        lambda: main.AuthedUser(id=user_id, token="stub-token")


client = TestClient(main.app, raise_server_exceptions=False)
alerts = []
observability.alert = alerts.append
main._password_matches = lambda uid, pw: pw == PASSWORD


print("\n[1] Coded IDs")
coded = analytics_keys.actor_id(ALICE)
check("a coded ID is 32 hex characters", len(coded) == 32 and int(coded, 16) >= 0, coded)
check("it's stable", analytics_keys.actor_id(ALICE) == coded)
check("it differs per person", analytics_keys.actor_id(BOB) != coded)
check("it doesn't contain the account id", ALICE.replace("-", "") not in coded)
check("the audit reference can't be joined with it", analytics_keys.admin_ref(ALICE)[:32] != coded)
check("fingerprints differ per secret",
      analytics_keys.fingerprint("id") != analytics_keys.fingerprint("audit"))
check("a fingerprint doesn't reveal the secret", ID_SECRET not in analytics_keys.fingerprint("id"))

saved = os.environ.pop("ANALYTICS_ID_SECRET")
check("no secret: no coded ID", analytics_keys.actor_id(ALICE) is None)
check("no secret: no fingerprint", analytics_keys.fingerprint("id") is None)
os.environ["ANALYTICS_ID_SECRET"] = "short"
check("a short secret counts as missing", analytics_keys.actor_id(ALICE) is None)
os.environ["ANALYTICS_ID_SECRET"] = saved
check("no user: no coded ID", analytics_keys.actor_id(None) is None)
check("the audit secret is independent", analytics_keys.admin_ref(ALICE) is not None)


print("\n[2] Essential events go through the consent RPC")


class RpcClient:
    def __init__(self):
        self.calls = []

    def rpc(self, name, params):
        self.calls.append((name, params))
        return NS(execute=lambda: NS(data=None))


rpc = RpcClient()
analytics.SupabaseAnalyticsStore(lambda: rpc).insert(analytics.build_event("research_completed"), ALICE)
name, params = rpc.calls[0]
check("writes through record_analytics_event", name == "record_analytics_event")
check("sends the coded ID", params["p_actor"] == coded)
check("sends the key fingerprint", params["p_fingerprint"] == analytics_keys.fingerprint("id"))
check("the row holds no user id", ALICE not in str(params["p_row"]))

saved = os.environ.pop("ANALYTICS_ID_SECRET")
rpc = RpcClient()
analytics.SupabaseAnalyticsStore(lambda: rpc).insert(analytics.build_event("research_completed"), ALICE)
params = rpc.calls[0][1]
check("no secret: the row is unlinked, never the raw id",
      params["p_actor"] is None and params["p_fingerprint"] is None and ALICE not in str(params["p_row"]), params)
os.environ["ANALYTICS_ID_SECRET"] = saved


class ScalarRpc(RpcClient):
    def __init__(self, data):
        super().__init__()
        self.data = data

    def rpc(self, name, params):
        self.calls.append((name, params))
        return NS(execute=lambda: NS(data=self.data))


real = analytics_privacy.SupabasePrivacyStore(
    lambda: ScalarRpc([{"status": "erasure_pending", "erasure_required": True}]))
check("set_consent reads the table result",
      real.set_consent(ALICE, True, "v1", "settings") == ("erasure_pending", True))
scalar = ScalarRpc(True)
real = analytics_privacy.SupabasePrivacyStore(lambda: scalar)
check("request_account_erasure reads a scalar", real.request_account_erasure(ALICE) is True)
check("  ...sending the named parameter", scalar.calls[-1] == ("request_account_erasure", {"p_user": ALICE}))
check("erase reads a scalar", real.erase(ALICE, "a", "f") is True)
check("heartbeat passes a missing fingerprint through",
      analytics_privacy.SupabasePrivacyStore(lambda: ScalarRpc("unavailable")).heartbeat("id", None) == "unavailable")
try:
    analytics_privacy.SupabasePrivacyStore(lambda: None).get_consent(ALICE)
    check("no client raises", False)
except RuntimeError:
    check("no client raises", True)


print("\n[3] Blocked requests are recorded, unlinked")


class Capture:
    def __init__(self):
        self.rows = []

    def insert(self, row, user_id=None):
        self.rows.append((row, user_id))


capture = Capture()
analytics.store = capture
analytics.record_blocked("moderation", "followup")
analytics.record_blocked("rate_limit")
analytics.record_blocked("self-harm")
analytics.flush(5)
check("reasons are a closed list", len(capture.rows) == 2, capture.rows)
row, user = capture.rows[0]
check("a blocked request has the reason as its stage",
      (row["event_type"], row["failure_stage"], row["request_type"], row["success"])
      == ("request_blocked", "moderation", "followup", False), row)
check("it's never linked to a person", all(user is None for _, user in capture.rows))

as_user(ALICE)


async def flagged(text, source, user_id=""):
    return NS(flagged=True, unavailable=False, category="self-harm", categories=["self-harm"])


saved_check = moderation.check
moderation.check = flagged
saved_blocked = moderation.blocked
moderation.blocked = lambda surface, verdict: HTTPException(status_code=400, detail="blocked")
capture.rows.clear()
main._require_schema = lambda db: _noop()


async def _noop():
    return None


main._db_for = lambda user: NS(is_connected=True)
client.post("/api/research", json={"query": "secret question"})
client.post("/api/research/stream", json={"query": "secret question"})
analytics.flush(5)
stages = [r["failure_stage"] for r, _ in capture.rows if r["event_type"] == "request_blocked"]
check("flagged questions record moderation on both endpoints", stages == ["moderation"] * 2, capture.rows)
check("the category is never stored", "self-harm" not in str(capture.rows))
moderation.check = saved_check
moderation.blocked = saved_blocked


print("\n[4] Consent endpoints")
store, auth = fresh()
main.get_admin_client = lambda: None
r = client.get("/api/analytics/consent")
check("no service role -> 503", r.status_code == 503, r.status_code)
store, auth = fresh()

body = client.get("/api/analytics/consent").json()
check("undecided", body == {"decided": False, "granted": False, "erasure_pending": False,
                            "erasure_completed": False}, body)

grant = {"granted": True, "source": "settings", "wording_version": "v1"}
withdraw = {"granted": False, "source": "settings", "wording_version": "v1"}
body = client.put("/api/analytics/consent", json=grant).json()
check("grant is saved", body["granted"] is True and store.consent[ALICE]["source"] == "settings", body)
check("a bad source is refused",
      client.put("/api/analytics/consent", json={**grant, "source": "email"}).status_code == 422)

store.linked.add(analytics_keys.actor_id(ALICE))
body = client.put("/api/analytics/consent", json=withdraw).json()
check("withdrawal erases linked rows at once", not store.linked and body["erasure_pending"] is False, body)
check("the completion notice is reported", body["erasure_completed"] is True, body)
r = client.post("/api/analytics/consent/notice")
check("the notice can be acknowledged", r.status_code == 200 and r.json()["erasure_completed"] is False, r.text)

store, auth = fresh()
client.put("/api/analytics/consent", json=grant)
store.linked.add(analytics_keys.actor_id(ALICE))
saved = os.environ.pop("ANALYTICS_ID_SECRET")
r = client.put("/api/analytics/consent", json=withdraw)
os.environ["ANALYTICS_ID_SECRET"] = saved
check("withdrawal works with no secret", r.status_code == 200 and r.json()["granted"] is False, r.text)
check("  ...and stays pending", r.json()["erasure_pending"] is True, r.text)
check("  ...recording why", store.requests[ALICE]["last_error_code"] == "key_unavailable", store.requests)
check("  ...with the account untouched", auth.banned == [] and auth.signed_out == [] and auth.deleted == [])
r = client.put("/api/analytics/consent", json=grant)
check("a grant is refused while an erase is pending", r.status_code == 409, r.status_code)

store, auth = fresh()
client.put("/api/analytics/consent", json=grant)
store.down.add("erase")
r = client.put("/api/analytics/consent", json=withdraw)
check("a database failure in the erase still withdraws", r.status_code == 200 and r.json()["granted"] is False, r.text)
check("  ...recording why", store.requests[ALICE]["last_error_code"] == "database_error", store.requests)

store, auth = fresh()
client.put("/api/analytics/consent", json=withdraw)
body = client.put("/api/analytics/consent", json={**grant, "source": "signup"}).json()
check("a later auth callback can't overturn a decision", body["granted"] is False, body)
check("  ...and nothing is saved", store.consent[ALICE]["source"] == "settings", store.consent)
store, auth = fresh()
body = client.put("/api/analytics/consent", json={**grant, "source": "signup"}).json()
check("the sign-up choice saves when there's no decision yet", body["granted"] is True, body)

store, auth = fresh()
store.down.add("set_consent")
r = client.put("/api/analytics/consent", json=withdraw)
check("if consent can't be saved the request fails", r.status_code == 500, r.status_code)

store, auth = fresh()
handler_records = []


class Handler(logging.Handler):
    def emit(self, record):
        handler_records.append(record.getMessage())


logging.getLogger("utils.audit").addHandler(Handler())
client.put("/api/analytics/consent", json=grant)
check("a change writes a security line", any("consent_changed" in m for m in handler_records), handler_records)
check("  ...with a hashed account id", not any(ALICE[:8] in m for m in handler_records), handler_records)


print("\n[5] Account deletion")
store, auth = fresh()
as_user(ALICE)
saved = os.environ.pop("ANALYTICS_ID_SECRET")
r = client.request("DELETE", "/api/account", json={"password": PASSWORD})
os.environ["ANALYTICS_ID_SECRET"] = saved
check("no linked data: deletes even with no secret",
      r.status_code == 200 and r.json()["status"] == "deleted" and auth.deleted == [ALICE], r.text)
check("  ...and never bans", auth.banned == [])

store, auth = fresh()
client.put("/api/analytics/consent", json=grant)
store.linked.add(analytics_keys.actor_id(ALICE))
r = client.request("DELETE", "/api/account", json={"password": PASSWORD})
check("linked data with a working key deletes at once",
      r.status_code == 200 and auth.deleted == [ALICE] and not store.linked, r.text)
check("  ...content went too", "delete_account_content" in store.calls)

store, auth = fresh()
client.put("/api/analytics/consent", json=grant)
store.linked.add(analytics_keys.actor_id(ALICE))
saved = os.environ.pop("ANALYTICS_ID_SECRET")
r = client.request("DELETE", "/api/account", json={"password": PASSWORD})
check("linked data with no secret -> 202 pending",
      r.status_code == 202 and r.json()["status"] == "pending", r.text)
check("  ...the account stays", auth.deleted == [])
check("  ...banned", auth.banned and auth.banned[0][0] == ALICE, auth.banned)
check("  ...sessions revoked", auth.signed_out == [("stub-token", "global")], auth.signed_out)
check("  ...chats gone", "delete_account_content" in store.calls)
check("  ...consent off", store.consent[ALICE]["granted"] is False)
analytics_privacy.tick()
check("a retry without the secret changes nothing", auth.deleted == [] and store.requests[ALICE]["status"] == "pending")
os.environ["ANALYTICS_ID_SECRET"] = saved
analytics_privacy.tick()
check("the retry finishes once the secret returns", auth.deleted == [ALICE] and not store.linked, store.requests)
check("  ...the request is gone", ALICE not in store.requests)

store, auth = fresh()
client.put("/api/analytics/consent", json=grant)
store.down.add("delete_account_content")
r = client.request("DELETE", "/api/account", json={"password": PASSWORD})
check("a failed content delete leaves the account disabled, not half gone",
      r.status_code == 202 and auth.deleted == [] and auth.banned, r.text)
store.down.clear()
analytics_privacy.tick()
check("  ...and the retry finishes it", auth.deleted == [ALICE], store.requests)

store, auth = fresh()
auth.fail_delete = True
r = client.request("DELETE", "/api/account", json={"password": PASSWORD})
check("a failed auth delete after the erase also goes pending", r.status_code == 202 and auth.banned, r.text)
auth.fail_delete = False
analytics_privacy.tick()
check("  ...and the retry finishes it", auth.deleted == [ALICE], store.requests)

store, auth = fresh()
store.down.add("request_account_erasure")
r = client.request("DELETE", "/api/account", json={"password": PASSWORD})
check("if the request can't be saved nothing happens", r.status_code == 500 and not auth.banned and not auth.deleted, r.text)


print("\n[6] A long fault with a healthy key")
store, auth = fresh()
client.put("/api/analytics/consent", json=grant)
store.linked.add(analytics_keys.actor_id(ALICE))
store.linked.add("someone-elses-rows")
store.down.add("erase")
client.request("DELETE", "/api/account", json={"password": PASSWORD})
check("the account is disabled", auth.banned and auth.deleted == [])

start = datetime.now(timezone.utc)
later = start + timedelta(days=8)
alerts.clear()
store.requests[ALICE]["requested_at"] = start.isoformat()
analytics_privacy.tick(now=later)
check("retries still run after seven days", store.requests[ALICE]["attempts"] >= 2, store.requests)
check("the account is still disabled", auth.deleted == [] and auth.banned, auth.deleted)
check("no failed retry unbans",
      all(attrs.get("ban_duration") != "none" for _, attrs in auth.banned), auth.banned)
check("an urgent alert fires", sum("URGENT" in a for a in alerts) == 1, alerts)
check("the alert has no account id", not any(ALICE[:8] in a for a in alerts), alerts)
check("the request is marked escalated", store.requests[ALICE]["escalated_at"] is not None)
check("no global erase runs", "someone-elses-rows" in store.linked and not hasattr(store, "global_erase_called"))

alerts.clear()
analytics_privacy.tick(now=later + timedelta(hours=1))
check("no second alert within a day", not any("URGENT" in a for a in alerts), alerts)
analytics_privacy.tick(now=later + timedelta(hours=25))
check("the alert repeats daily", sum("URGENT" in a for a in alerts) == 1, alerts)

store.down.clear()
analytics_privacy.tick(now=later + timedelta(hours=26))
check("it completes once the fault clears", auth.deleted == [ALICE], store.requests)
check("no effect on anyone else", "someone-elses-rows" in store.linked)


print("\n[7] A pending withdrawal keeps the account")
store, auth = fresh()
client.put("/api/analytics/consent", json=grant)
store.down.add("erase")
client.put("/api/analytics/consent", json=withdraw)
store.requests[ALICE]["requested_at"] = start.isoformat()
for days in (1, 3, 8, 30):
    analytics_privacy.tick(now=start + timedelta(days=days))
check("retries continue past seven days", store.requests[ALICE]["attempts"] >= 4, store.requests)
check("the account is never banned", auth.banned == [] and auth.signed_out == [] and auth.deleted == [])
body = client.get("/api/analytics/consent").json()
check("the person can still use the API", body["erasure_pending"] is True, body)
store.down.clear()
analytics_privacy.tick(now=start + timedelta(days=31))
body = client.get("/api/analytics/consent").json()
check("the notice appears after the erase", body["erasure_completed"] is True and body["erasure_pending"] is False, body)


print("\n[8] Key loss resolves requests through the separate runbook")
store, auth = fresh()
client.put("/api/analytics/consent", json=grant)
saved = os.environ.pop("ANALYTICS_ID_SECRET")
client.request("DELETE", "/api/account", json={"password": PASSWORD})
analytics_privacy.tick()
check("pending while the key is missing", auth.deleted == [] and store.requests[ALICE]["status"] == "pending")
store.requests[ALICE]["status"] = "erased"  # what declare_analytics_key_lost() does
analytics_privacy.tick()
check("the account deletion then finishes with no secret", auth.deleted == [ALICE], store.requests)
os.environ["ANALYTICS_ID_SECRET"] = saved
check("the app has no route to a global erase",
      "declare_analytics_key_lost" not in open(analytics_privacy.__file__).read())


print("\n[9] Monitoring")
now = datetime.now(timezone.utc)
healthy = {
    "last_purge_at": (now - timedelta(hours=2)).isoformat(),
    "last_purge_failed": False,
    "oldest_row_seconds": {"product_events": 3600, "analytics_events": None, "usage_daily": 3600},
    "pending_erasures": 0,
    "oldest_pending_seconds": None,
    "key_states": {"id": "ok", "audit": "ok"},
}
check("healthy", analytics_privacy.problems(healthy, now) == [], analytics_privacy.problems(healthy, now))
cases = [
    ("a stale purge", {"last_purge_at": (now - timedelta(hours=31)).isoformat()}, "purge_stale"),
    ("no purge yet", {"last_purge_at": None}, "purge_stale"),
    ("a failed purge", {"last_purge_failed": True}, "purge_failed"),
    ("an old row", {"oldest_row_seconds": {"product_events": 93 * 86400}}, "row_too_old"),
    ("a bad id key", {"key_states": {"id": "unavailable", "audit": "ok"}}, "key_id_unavailable"),
    ("a lost id key", {"key_states": {"id": "lost", "audit": "ok"}}, "key_id_lost"),
    ("a missing key row", {"key_states": {"audit": "ok"}}, "key_id_missing"),
    ("a bad audit key", {"key_states": {"id": "ok", "audit": "unavailable"}}, "key_audit_unavailable"),
    ("a day-old erase", {"pending_erasures": 1, "oldest_pending_seconds": 25 * 3600}, "erasure_pending"),
    ("a three-day-old erase", {"pending_erasures": 1, "oldest_pending_seconds": 73 * 3600}, "erasure_stuck"),
    ("a week-old erase", {"pending_erasures": 1, "oldest_pending_seconds": 8 * 86400}, "erasure_urgent"),
]
for label, change, code in cases:
    found = analytics_privacy.problems({**healthy, **change}, now)
    check(f"detects {label}", code in found, found)
check("a recent erase isn't a problem",
      analytics_privacy.problems({**healthy, "pending_erasures": 1, "oldest_pending_seconds": 3600}, now) == [])

store, auth = fresh()
store.health_data = {**healthy, "last_purge_at": None}
alerts.clear()
analytics_privacy.tick(now=now)
check("the self-check alerts", any("purge_stale" in a for a in alerts), alerts)
alerts.clear()
analytics_privacy.tick(now=now + timedelta(hours=1))
check("once a day", not any("purge_stale" in a for a in alerts), alerts)
analytics_privacy.tick(now=now + timedelta(days=1))
check("  ...and again the next day", any("purge_stale" in a for a in alerts), alerts)

store, auth = fresh()
store.down.add("health")
alerts.clear()
analytics_privacy.tick(now=now)
check("a failing self-check alerts too", any("health" in a.lower() for a in alerts), alerts)

store, auth = fresh()
store.keys["id"] = "missing"
analytics_privacy.tick(now=now)
check("heartbeats run each tick", "heartbeat" in store.calls)


print("\n[9b] usage_daily is limits only")
backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for name in ("analytics.py", "analytics_summary.py", "analytics_privacy.py"):
    with open(os.path.join(backend, "utils", name)) as f:
        check(f"{name} never reads usage_daily", "usage_daily" not in f.read())


print("\n[10] Health endpoint")
PATH = "/api/internal/analytics/purge-health"
store, auth = fresh()
store.health_data = healthy
check("no token configured -> 404",
      client.get(PATH, headers={"Authorization": "Bearer "}).status_code == 404)
os.environ["PURGE_HEALTH_TOKEN"] = HEALTH_TOKEN
os.environ["PURGE_HEALTH_TOKEN_PREVIOUS"] = "p" * 40
headers = {"Authorization": f"Bearer {HEALTH_TOKEN}"}
r = client.get(PATH, headers=headers)
check("the right token works", r.status_code == 200 and r.json()["ok"] is True, r.text)
check("no-store", r.headers.get("cache-control") == "no-store", r.headers)
check("no CORS headers", not any(k.lower().startswith("access-control") for k in r.headers), r.headers)
check("the previous token works during rotation",
      client.get(PATH, headers={"Authorization": "Bearer " + "p" * 40}).status_code == 200)
for label, bad in [("no token", {}), ("a wrong token", {"Authorization": "Bearer nope"}),
                   ("a token in another scheme", {"Authorization": f"Basic {HEALTH_TOKEN}"})]:
    check(f"{label} -> 404", client.get(PATH, headers=bad).status_code == 404)
check("a token in the URL -> 404", client.get(f"{PATH}?token={HEALTH_TOKEN}").status_code == 404)
origin = "http://localhost:3000"
r = client.get(PATH, headers={**headers, "Origin": origin})
check("a browser Origin -> 404", r.status_code == 404, r.status_code)
check("  ...with no CORS headers", not any(k.lower().startswith("access-control") for k in r.headers), r.headers)
check("Sec-Fetch-Site -> 404", client.get(PATH, headers={**headers, "Sec-Fetch-Site": "same-site"}).status_code == 404)
r = client.options(PATH, headers={"Origin": origin, "Access-Control-Request-Method": "GET"})
check("a preflight gets nothing", r.status_code == 404 and "access-control-allow-origin" not in r.headers, r.status_code)
check("only GET", client.post(PATH, headers=headers).status_code == 404)
check("not in the schema", PATH not in main.app.openapi()["paths"])

store.health_data = {**healthy, "pending_erasures": 1, "oldest_pending_seconds": 8 * 86400}
body = client.get(PATH, headers=headers).json()
check("reports a problem", body["ok"] is False and body["urgent"] is True, body)
check("only codes and counts", set(body) == {"ok", "urgent", "problems", "pending_erasures", "last_purge_at"}, body)
store.down.add("health")
r = client.get(PATH, headers=headers)
check("a database failure is a failing check", r.status_code == 200 and r.json()["ok"] is False, r.text)
check("the token isn't scrubbed-in to Sentry",
      "authorization" not in {k.lower() for k in (observability.scrub_event(
          {"request": {"headers": {"Authorization": "Bearer x"}}})["request"]["headers"])})
os.environ["PURGE_HEALTH_TOKEN"] = ""
os.environ["PURGE_HEALTH_TOKEN_PREVIOUS"] = ""

main.app.dependency_overrides.clear()
if failures:
    print(f"\n{len(failures)} FAILED: {failures}")
    sys.exit(1)
print("\nAll analytics privacy tests passed.")
