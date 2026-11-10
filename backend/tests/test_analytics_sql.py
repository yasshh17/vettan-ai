"""
Analytics privacy SQL tests. These need a real Postgres, because consent races
can't be faked: set ANALYTICS_TEST_DATABASE_URL to a server where this role can
create databases. Without it they skip, so the other suites run with no services.

    ANALYTICS_TEST_DATABASE_URL=postgresql://... python tests/test_analytics_sql.py
"""
import json
import os
import sys
import threading
import time
import uuid
from pathlib import Path

URL = os.getenv("ANALYTICS_TEST_DATABASE_URL", "").strip()
if not URL:
    print("SKIP: ANALYTICS_TEST_DATABASE_URL is not set")
    sys.exit(0)

import psycopg  # noqa: E402
from psycopg.conninfo import make_conninfo, conninfo_to_dict  # noqa: E402
from psycopg.types.json import Jsonb  # noqa: E402

MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"
DB_NAME = f"analytics_sql_{uuid.uuid4().hex[:8]}"
KEY = "a" * 64
OTHER_KEY = "b" * 64
LOST = "I-HAVE-LOST-THE-ANALYTICS-ID-SECRET"

failures = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + str(detail) if detail and not cond else ''}")
    if not cond:
        failures.append(label)


BOOTSTRAP = """
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql as 'select null::uuid';
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
"""


def admin_conn():
    return psycopg.connect(URL, autocommit=True)


with admin_conn() as admin:
    admin.execute(f'create database "{DB_NAME}"')

params = conninfo_to_dict(URL)
params["dbname"] = DB_NAME
DSN = make_conninfo(**params)


def connect(autocommit=True):
    return psycopg.connect(DSN, autocommit=autocommit)


db = connect()
db.execute(BOOTSTRAP)
for path in sorted(MIGRATIONS.glob("*.sql")):
    if path.name.startswith(("0002", "0013")):
        continue
    db.execute(path.read_text())
db.execute((MIGRATIONS / "0011_analytics_privacy.sql").read_text())

key_fp = "fp-" + KEY[:8]
other_fp = "fp-" + OTHER_KEY[:8]


def new_user():
    user = str(uuid.uuid4())
    db.execute("insert into auth.users (id) values (%s)", (user,))
    return user


def actor():
    return uuid.uuid4().hex


def set_consent(user, granted, conn=None):
    row = (conn or db).execute(
        "select status, erasure_required from public.set_analytics_consent(%s, %s, 'v1', 'settings')",
        (user, granted),
    ).fetchone()
    return row


def write_product(user, who, fp=key_fp, conn=None, event="chat_opened", visit=None):
    events = [{"event": event, "visit_id": visit, "props": {}}]
    return (conn or db).execute(
        "select public.record_product_events(%s, %s, %s, %s)", (user, who, fp, Jsonb(events))
    ).fetchone()[0]


def write_essential(user, who, fp=key_fp, conn=None):
    row = {"event_type": "research_completed", "request_type": "research", "success": True}
    (conn or db).execute(
        "select public.record_analytics_event(%s, %s, %s, %s)", (user, who, fp, Jsonb(row))
    )


def count(table, where="true", args=()):
    return db.execute(f"select count(*) from public.{table} where {where}", args).fetchone()[0]


def linked(table, who):
    return count(table, "actor_id = %s", (who,))


def erase(user, who, fp=key_fp):
    return db.execute(
        "select public.erase_linked_analytics(%s, %s, %s)", (user, who, fp)
    ).fetchone()[0]


def consent_row(user):
    return db.execute(
        "select granted, erasure_completed_at from public.analytics_consent where user_id = %s", (user,)
    ).fetchone()


def request_row(user):
    return db.execute(
        "select kind, status from public.analytics_erasure_requests where user_id = %s", (user,)
    ).fetchone()


def fails(fn):
    try:
        fn()
        return False
    except psycopg.Error:
        return True


try:
    print("Client access:")
    db.execute("select public.install_analytics_key('id', %s, 'init', null)", (key_fp,))
    db.execute("select public.install_analytics_key('audit', 'audit-fp', 'init', null)")
    tables = [
        "analytics_consent", "analytics_erasure_requests", "product_events",
        "analytics_key_check", "analytics_purge_log", "analytics_access_log",
    ]
    functions = [
        ("set_analytics_consent", "null::uuid, true, 'v', 'settings'"),
        ("record_product_events", "null::uuid, 'a', 'f', '[]'::jsonb"),
        ("erase_linked_analytics", "null::uuid, 'a', 'f'"),
        ("declare_analytics_key_lost", "'x'"),
        ("purge_analytics", ""),
        ("analytics_health", ""),
    ]
    for role in ("anon", "authenticated"):
        with connect() as c:
            c.execute(f"set role {role}")
            for table in tables:
                check(f"{role} can't read {table}", fails(lambda: c.execute(f"select * from public.{table}")))
                check(f"{role} can't write {table}",
                      fails(lambda: c.execute(f"delete from public.{table}")))
            for name, args in functions:
                check(f"{role} can't call {name}", fails(lambda: c.execute(f"select public.{name}({args})")))
    with connect() as c:
        c.execute("set role service_role")
        c.execute("select public.analytics_health()")
        check("service role can call the RPCs", True)

    print("\nConsent at write time:")
    user, who = new_user(), actor()
    check("no consent row: product event dropped", write_product(user, who) == 0 and linked("product_events", who) == 0)
    write_essential(user, who)
    check("no consent row: essential row stored unlinked",
          count("analytics_events") == 1 and linked("analytics_events", who) == 0)

    set_consent(user, False)
    check("declined: product event dropped", write_product(user, who) == 0)
    write_essential(user, who)
    check("declined: essential row stays unlinked", linked("analytics_events", who) == 0)
    check("declining without a grant needs no erasure", request_row(user) is None)

    set_consent(user, True)
    check("granted: product event stored", write_product(user, who, visit=str(uuid.uuid4())) == 1)
    write_essential(user, who)
    check("granted: essential row linked", linked("analytics_events", who) == 1)

    check("wrong key: product event dropped", write_product(user, who, other_fp) == 0)
    before = linked("analytics_events", who)
    write_essential(user, who, other_fp)
    check("wrong key: essential row stays unlinked", linked("analytics_events", who) == before)

    print("\nRaces:")
    user, who = new_user(), actor()
    with connect(autocommit=False) as a:
        set_consent(user, True, conn=a)
        check("a write can't see an uncommitted grant", write_product(user, who) == 0)
        a.commit()
    check("the dropped event is not retried", linked("product_events", who) == 0)
    check("writes work once the grant commits", write_product(user, who) == 1)

    user, who = new_user(), actor()
    set_consent(user, True)
    writer = connect(autocommit=False)
    write_product(user, who, conn=writer)
    outcome = {}

    def withdraw():
        with connect() as c:
            started = time.monotonic()
            outcome["row"] = set_consent(user, False, conn=c)
            outcome["waited"] = time.monotonic() - started

    thread = threading.Thread(target=withdraw)
    thread.start()
    time.sleep(0.4)
    check("withdrawal waits for a write in progress", thread.is_alive())
    writer.commit()
    writer.close()
    thread.join(5)
    check("withdrawal then finishes", outcome.get("row", (None,))[0] == "ok", outcome)
    erase(user, who)
    check("no linked row survives the race", linked("product_events", who) == 0)
    check("later product writes are dropped", write_product(user, who) == 0)
    write_essential(user, who)
    check("later essential writes stay unlinked", linked("analytics_events", who) == 0)

    # A queued write or running request is judged when it reaches the database.
    user, who = new_user(), actor()
    set_consent(user, True)
    queued_events = [{"event": "chat_opened", "visit_id": None, "props": {}}]
    set_consent(user, False)
    written = db.execute(
        "select public.record_product_events(%s, %s, %s, %s)", (user, who, key_fp, Jsonb(queued_events))
    ).fetchone()[0]
    check("an event queued before withdrawal is dropped", written == 0)
    write_essential(user, who)
    check("a request active during withdrawal stores an unlinked row", linked("analytics_events", who) == 0)

    print("\nWithdrawal:")
    user, who, bystander, other = new_user(), actor(), new_user(), actor()
    set_consent(user, True)
    set_consent(bystander, True)
    write_product(user, who)
    write_essential(user, who)
    write_product(bystander, other)
    unlinked_before = count("analytics_events", "actor_id is null")
    status, required = set_consent(user, False)
    check("withdrawal reports that an erase is needed", (status, required) == ("ok", True))
    check("step 1 leaves a pending request", request_row(user) == ("withdrawal", "pending"))
    check("the erase refuses the wrong key", fails(lambda: erase(user, who, other_fp)))
    check("a failed erase can't undo the withdrawal", consent_row(user)[0] is False)
    check("the request stays pending after a failed erase", request_row(user) == ("withdrawal", "pending"))
    check("a grant is refused while an erase is pending", set_consent(user, True)[0] == "erasure_pending")
    check("  ...and consent stays off", consent_row(user)[0] is False)
    check("erase finishes", erase(user, who) is True)
    check("linked rows are gone", linked("product_events", who) == 0 and linked("analytics_events", who) == 0)
    check("another person's rows are untouched", linked("product_events", other) == 1)
    check("unlinked rows stay", count("analytics_events", "actor_id is null") == unlinked_before)
    check("the completion notice is set", consent_row(user)[1] is not None)
    check("the request row is removed", request_row(user) is None)
    db.execute("select public.ack_analytics_erasure_notice(%s)", (user,))
    check("the notice clears once seen", consent_row(user)[1] is None)
    check("erasing again is harmless", erase(user, who) is False)
    set_consent(user, True)
    write_product(user, who)
    check("consenting again starts empty", linked("product_events", who) == 1)

    print("\nAccount deletion:")
    user = new_user()
    set_consent(user, False)
    needs = db.execute("select public.request_account_erasure(%s)", (user,)).fetchone()[0]
    check("no linked data needs no erase", needs is False)
    db.execute("delete from auth.users where id = %s", (user,))
    check("the account deletes, and rows cascade",
          consent_row(user) is None and request_row(user) is None)

    user, who = new_user(), actor()
    set_consent(user, True)
    write_product(user, who)
    needs = db.execute("select public.request_account_erasure(%s)", (user,)).fetchone()[0]
    check("linked data needs an erase", needs is True)
    check("deletion turns consent off", consent_row(user)[0] is False)
    check("the database blocks deleting the user while pending",
          fails(lambda: db.execute("delete from auth.users where id = %s", (user,))))
    check("the user survives", db.execute(
        "select count(*) from auth.users where id = %s", (user,)).fetchone()[0] == 1)
    check("repeating the request is safe",
          db.execute("select public.request_account_erasure(%s)", (user,)).fetchone()[0] is True)
    erase(user, who)
    check("the request is marked erased", request_row(user) == ("account", "erased"))
    db.execute("delete from auth.users where id = %s", (user,))
    check("deletion works once erased", request_row(user) is None and linked("product_events", who) == 0)

    user, who = new_user(), actor()
    set_consent(user, True)
    set_consent(user, False)
    check("withdrawal pending", request_row(user) == ("withdrawal", "pending"))
    db.execute("select public.request_account_erasure(%s)", (user,))
    check("account deletion upgrades a pending withdrawal", request_row(user) == ("account", "pending"))
    erase(user, who)

    user = new_user()
    session = str(uuid.uuid4())
    db.execute(
        "insert into public.research_sessions (id, query, report, user_id) values (%s, 'q', 'r', %s)",
        (session, user),
    )
    db.execute(
        "insert into public.answer_feedback (user_id, session_id, message_id, rating) values (%s, %s, %s, 'up')",
        (user, session, str(uuid.uuid4())),
    )
    db.execute("select public.delete_account_content(%s)", (user,))
    check("content delete removes chats",
          count("research_sessions", "user_id = %s", (user,)) == 0)
    check("content delete removes feedback", count("answer_feedback", "user_id = %s", (user,)) == 0)

    print("\nKeys:")
    state = lambda name="id": db.execute(
        "select state from public.analytics_key_check where name = %s", (name,)).fetchone()[0]
    check("a second init is refused",
          fails(lambda: db.execute("select public.install_analytics_key('id', 'x', 'init', null)")))
    db.execute("select public.analytics_key_heartbeat('id', %s)", (other_fp,))
    check("a mismatch marks the key unavailable", state() == "unavailable")
    user, who = new_user(), actor()
    set_consent(user, True)
    check("a wrong key can't write", write_product(user, who, other_fp) == 0)
    leaver, leaver_who = new_user(), actor()
    set_consent(leaver, True)
    check("one bad backend doesn't stop the right key", write_product(leaver, leaver_who) == 1)
    set_consent(leaver, False)
    check("nor does it stop an erase",
          erase(leaver, leaver_who) is True and linked("product_events", leaver_who) == 0)
    db.execute("select public.analytics_key_heartbeat('id', null)")
    check("a missing secret stays unavailable", state() == "unavailable")
    check("a missing secret can't write", write_product(user, who, None) == 0)
    db.execute("select public.analytics_key_heartbeat('id', %s)", (key_fp,))
    check("the original key restores it", state() == "ok")
    check("writes resume", write_product(user, who) == 1)
    check("rotation refuses the wrong old key", fails(lambda: db.execute(
        "select public.install_analytics_key('audit', 'new', 'rotate', 'wrong')")))
    check("the id key can only move through a re-key, or rows would be orphaned", fails(lambda: db.execute(
        "select public.install_analytics_key('id', 'new', 'rotate', %s)", (key_fp,))))
    db.execute("select public.install_analytics_key('audit', 'audit-2', 'rotate', 'audit-fp')")
    check("rotating the audit key bumps its epoch", db.execute(
        "select epoch from public.analytics_key_check where name = 'audit'").fetchone()[0] == 2)
    db.execute("select public.install_analytics_key('audit', 'audit-3', 'after_loss', null)")
    check("a lost audit key can be replaced", db.execute(
        "select fingerprint, epoch from public.analytics_key_check where name = 'audit'").fetchone() == ("audit-3", 3))

    new_who = actor()
    bad_pairs = Jsonb([])
    check("re-keying refuses to leave rows behind", fails(lambda: db.execute(
        "select public.rekey_analytics_actors(%s, %s, %s)", (bad_pairs, key_fp, other_fp))))
    all_actors = [r[0] for r in db.execute(
        "select distinct actor_id from public.product_events union "
        "select distinct actor_id from public.analytics_events where actor_id is not null").fetchall()]
    pairs = [{"old": a, "new": (new_who if a == who else a)} for a in all_actors]
    db.execute("select public.rekey_analytics_actors(%s, %s, %s)", (Jsonb(pairs), key_fp, other_fp))
    check("re-keying moves links", linked("product_events", new_who) == 1 and linked("product_events", who) == 0)
    check("re-keying installs the new key", write_product(user, new_who, other_fp) == 1)
    db.execute("select public.rekey_analytics_actors(%s, %s, %s)",
               (Jsonb([{"old": a, "new": a} for a in all_actors + [new_who]]), other_fp, key_fp))

    print("\nPurge:")
    purge_user, purge_who = new_user(), actor()
    set_consent(purge_user, True)
    write_product(purge_user, purge_who)
    db.execute("update public.product_events set created_at = now() - interval '91 days' where actor_id = %s",
               (purge_who,))
    write_product(purge_user, purge_who, event="page_viewed")
    write_essential(purge_user, purge_who)
    db.execute("update public.analytics_events set created_at = now() - interval '91 days' where actor_id = %s",
               (purge_who,))
    db.execute("insert into public.usage_daily (user_id, day) values (%s, current_date - 91), (%s, current_date)",
               (purge_user, purge_user))
    db.execute("insert into public.analytics_purge_log (run_at, table_name, status) values (now() - interval '400 days', 'old', 'ok')")
    db.execute("insert into public.analytics_access_log (created_at, admin_ref, key_epoch, action) values (now() - interval '400 days', 'x', 1, 'old')")
    pending_user, pending_who = new_user(), actor()
    set_consent(pending_user, True)
    write_product(pending_user, pending_who)
    set_consent(pending_user, False)
    db.execute("update public.analytics_erasure_requests set requested_at = now() - interval '8 days' where user_id = %s",
               (pending_user,))
    db.execute("update public.analytics_key_check set last_ok_at = now() - interval '8 days' where name = 'id'")
    linked_before = count("product_events", "true") - 1

    db.execute("select public.purge_analytics()")
    check("old product events go", count("product_events", "actor_id = %s and event = 'chat_opened'", (purge_who,)) == 0)
    check("recent product events stay", count("product_events", "actor_id = %s", (purge_who,)) == 1)
    check("old essential rows go", linked("analytics_events", purge_who) == 0)
    check("old usage rows go", count("usage_daily", "user_id = %s and day < current_date", (purge_user,)) == 0)
    check("today's usage row stays", count("usage_daily", "user_id = %s and day = current_date", (purge_user,)) == 1)
    check("each table logs a run",
          count("analytics_purge_log", "status = 'ok' and run_at > now() - interval '1 minute'") >= 3)
    check("year-old purge logs go", count("analytics_purge_log", "table_name = 'old'") == 0)
    check("year-old access logs go", count("analytics_access_log", "action = 'old'") == 0)
    check("purge never erases on a stale key and old request",
          count("product_events", "true") == linked_before)
    check("  ...the pending person's rows stay", linked("product_events", pending_who) == 1)
    check("  ...the key isn't marked lost", state() == "ok")
    check("  ...the request stays pending", request_row(pending_user) == ("withdrawal", "pending"))

    print("\nHealth:")
    db.execute("select public.mark_erasure_attempt(%s, 'database_error')", (pending_user,))
    health = db.execute("select public.analytics_health()").fetchone()[0]
    check("health reports the last purge", health["last_purge_at"] is not None, health)
    check("health reports the pending count", health["pending_erasures"] >= 1, health)
    check("health reports the oldest pending age", health["oldest_pending_seconds"] >= 7 * 86400, health)
    check("health reports key states", health["key_states"].get("id") == "ok", health)
    check("health reports table ages", "product_events" in health["oldest_row_seconds"], health)
    check("attempts are counted", db.execute(
        "select attempts, last_error_code from public.analytics_erasure_requests where user_id = %s",
        (pending_user,)).fetchone() == (1, "database_error"))
    db.execute("select public.mark_erasure_escalated(%s)", (pending_user,))
    check("escalation only marks the request", request_row(pending_user) == ("withdrawal", "pending") and db.execute(
        "select escalated_at is not null from public.analytics_erasure_requests where user_id = %s",
        (pending_user,)).fetchone()[0])

    print("\nBackfill:")
    a_user, b_user, a_who, b_who = new_user(), new_user(), actor(), actor()
    set_consent(a_user, True)
    db.execute("""insert into public.analytics_events (user_id, event_type, request_type, success)
                  values (%s, 'research_completed', 'research', true),
                         (%s, 'research_completed', 'research', true)""", (a_user, b_user))
    pairs = [{"user_id": a_user, "actor_id": a_who}, {"user_id": b_user, "actor_id": b_who}]
    done = db.execute("select public.backfill_analytics_actors(%s, %s)", (Jsonb(pairs), key_fp)).fetchone()[0]
    check("the backfill links consenting people", linked("analytics_events", a_who) == 1)
    check("the backfill skips people without consent", linked("analytics_events", b_who) == 0, done)
    check("the backfill refuses the wrong key", fails(lambda: db.execute(
        "select public.backfill_analytics_actors(%s, %s)", (Jsonb(pairs), other_fp))))

    print("\nBlocked requests:")
    row = {"event_type": "request_blocked", "request_type": "research", "success": False,
           "failure_stage": "moderation"}
    db.execute("select public.record_analytics_event(null, null, null, %s)", (Jsonb(row),))
    check("request_blocked is stored unlinked",
          count("analytics_events", "event_type = 'request_blocked' and actor_id is null and failure_stage = 'moderation'") == 1)

    print("\nPermanent key loss:")
    lost_user, lost_who, acct_user, acct_who = new_user(), actor(), new_user(), actor()
    keep_user, keep_who = new_user(), actor()
    set_consent(lost_user, True)
    set_consent(acct_user, True)
    set_consent(keep_user, True)
    write_product(lost_user, lost_who)
    write_product(acct_user, acct_who)
    write_product(keep_user, keep_who)
    set_consent(lost_user, False)
    db.execute("select public.request_account_erasure(%s)", (acct_user,))
    unlinked_before = count("analytics_events", "actor_id is null")
    check("declaring needs the exact confirmation",
          fails(lambda: db.execute("select public.declare_analytics_key_lost('yes')")))
    check("nothing changed", linked("product_events", keep_who) == 1)
    db.execute("select public.declare_analytics_key_lost(%s)", (LOST,))
    check("every linked row is erased",
          count("product_events") == 0 and count("analytics_events", "actor_id is not null") == 0)
    check("unlinked rows stay", count("analytics_events", "actor_id is null") == unlinked_before)
    check("the key is marked lost", state() == "lost")
    check("withdrawal requests finish", request_row(lost_user) is None and consent_row(lost_user)[1] is not None)
    check("account requests are erased", request_row(acct_user) == ("account", "erased"))
    db.execute("delete from auth.users where id = %s", (acct_user,))
    check("pending account deletions can then finish", request_row(acct_user) is None)
    check("consent choices are kept", consent_row(keep_user)[0] is True)
    check("no linked writes while lost", write_product(keep_user, keep_who) == 0)
    db.execute("select public.analytics_key_heartbeat('id', %s)", (key_fp,))
    check("a heartbeat can't clear lost", state() == "lost")
    check("the old key can't be reinstalled by init", fails(lambda: db.execute(
        "select public.install_analytics_key('id', 'new', 'init', null)")))
    db.execute("select public.install_analytics_key('id', %s, 'after_loss', null)", (other_fp,))
    check("a new key installs after loss", state() == "ok")
    check("linked analytics restarts", write_product(keep_user, keep_who, other_fp) == 1)

    print("\nConstraints:")
    bad = [{"event": "Not An Event", "visit_id": None, "props": {}}]
    check("event names are checked", fails(lambda: db.execute(
        "select public.record_product_events(%s, %s, %s, %s)", (keep_user, keep_who, other_fp, Jsonb(bad)))))
    big = [{"event": "chat_opened", "visit_id": None, "props": {"x": "y" * 2000}}]
    check("props size is capped", fails(lambda: db.execute(
        "select public.record_product_events(%s, %s, %s, %s)", (keep_user, keep_who, other_fp, Jsonb(big)))))
finally:
    db.close()
    with admin_conn() as admin:
        admin.execute(f'drop database if exists "{DB_NAME}" with (force)')

if failures:
    print(f"\n{len(failures)} failed:")
    for failure in failures:
        print(f"  - {failure}")
    sys.exit(1)
print("\nAll analytics SQL tests passed.")
