"""
Runbook logic behind backend/scripts. The RPCs they call run on a real Postgres
in test_analytics_sql.py.

    python tests/test_analytics_runbooks.py
"""
import contextlib
import io
import os
import re
import subprocess
import sys
import textwrap
from pathlib import Path
from types import SimpleNamespace as NS

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils import analytics_keys, analytics_runbooks as runbooks  # noqa: E402

failures = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + str(detail) if detail and not cond else ''}")
    if not cond:
        failures.append(label)


ALICE, BOB, CAROL = "a" * 8, "b" * 8, "c" * 8
OLD = ("o" * 64).encode()
NEW = ("n" * 64).encode()


class Query:
    def __init__(self, rows):
        self.rows = rows
        self.filters = {}
        self.start = 0
        self.stop = None

    def select(self, columns):
        return self

    def eq(self, column, value):
        self.rows = [r for r in self.rows if r.get(column) == value]
        return self

    def order(self, column):
        return self

    def range(self, start, stop):
        self.start, self.stop = start, stop
        return self

    def execute(self):
        rows = self.rows if self.stop is None else self.rows[self.start:self.stop + 1]
        return NS(data=rows)


class Client:
    def __init__(self):
        self.tables = {
            "analytics_consent": [
                {"user_id": ALICE, "granted": True},
                {"user_id": BOB, "granted": False},
            ],
            "analytics_erasure_requests": [{"user_id": CAROL, "status": "pending"}],
            "product_events": [],
            "analytics_events": [],
        }
        self.calls = []

    def table(self, name):
        return Query(list(self.tables[name]))

    def rpc(self, name, params):
        self.calls.append((name, params))
        return NS(execute=lambda: NS(data={"product_events": 2}))


print("\n[1] Secrets")
for label, value in [("missing", None), ("short", b"short")]:
    try:
        runbooks.require_secret(value)
        check(f"a {label} secret is refused", False)
    except ValueError:
        check(f"a {label} secret is refused", True)

print("\n[2] Backfill")
client = Client()
runbooks.backfill(client, OLD)
name, params = client.calls[0]
pairs = params["p_pairs"]
check("calls the backfill RPC", name == "backfill_analytics_actors")
check("only consenting people get a code", [p["user_id"] for p in pairs] == [ALICE], pairs)
check("codes come from the given secret", pairs[0]["actor_id"] == analytics_keys.actor_id(ALICE, OLD))
check("sends the key fingerprint", params["p_fingerprint"] == analytics_keys.fingerprint("id", OLD))

print("\n[3] Re-key")
client = Client()
runbooks.rekey(client, OLD, NEW)
name, params = client.calls[0]
mapped = {p["old"]: p["new"] for p in params["p_pairs"]}
check("calls the re-key RPC", name == "rekey_analytics_actors")
check("covers consenting people and pending erasures",
      set(mapped) == {analytics_keys.actor_id(ALICE, OLD), analytics_keys.actor_id(CAROL, OLD)}, mapped)
check("maps to the new secret", mapped[analytics_keys.actor_id(ALICE, OLD)] == analytics_keys.actor_id(ALICE, NEW))
check("passes both fingerprints",
      (params["p_old_fingerprint"], params["p_new_fingerprint"])
      == (analytics_keys.fingerprint("id", OLD), analytics_keys.fingerprint("id", NEW)))
try:
    runbooks.rekey(Client(), OLD, OLD)
    check("re-keying to the same secret is refused", False)
except ValueError:
    check("re-keying to the same secret is refused", True)

print("\n[4] Install")
client = Client()
runbooks.install_key(client, "id", "init", OLD)
params = client.calls[0][1]
check("init sends only a fingerprint",
      params["p_fingerprint"] == analytics_keys.fingerprint("id", OLD) and params["p_mode"] == "init", params)
check("the secret never leaves the machine", OLD.decode() not in str(client.calls))
client = Client()
runbooks.install_key(client, "audit", "rotate", NEW, OLD)
params = client.calls[0][1]
check("audit rotation sends the old fingerprint",
      params["p_old_fingerprint"] == analytics_keys.fingerprint("audit", OLD), params)

print("\n[5] Declaring loss")
client = Client()
try:
    runbooks.declare_lost(client, "yes")
    check("needs the exact confirmation", False)
except ValueError:
    check("needs the exact confirmation", client.calls == [])
result = runbooks.declare_lost(client, runbooks.LOST_CONFIRMATION)
check("calls the RPC once confirmed", client.calls[0][0] == "declare_analytics_key_lost", client.calls)
check("reports what was erased", result == {"product_events": 2}, result)

print("\n[6] Subject export")
client = Client()
actor = analytics_keys.actor_id(ALICE, OLD)
client.tables["product_events"] = [{"actor_id": actor, "event": "chat_opened"}, {"actor_id": "other", "event": "x"}]
client.tables["analytics_events"] = [{"actor_id": actor, "event_type": "research_completed"}]
export = runbooks.export_subject(client, ALICE, OLD)
check("includes the consent record", export["consent"]["granted"] is True, export)
check("includes that person's events only",
      [e["event"] for e in export["product_events"]] == ["chat_opened"], export)
check("includes essential rows linked to them", len(export["analytics_events"]) == 1, export)

print("\n[7] Output")
buffer = io.StringIO()
with contextlib.redirect_stdout(buffer):
    client = Client()
    runbooks.install_key(client, "id", "init", OLD)
    runbooks.rekey(Client(), OLD, NEW)
check("nothing prints a secret", OLD.decode() not in buffer.getvalue() and NEW.decode() not in buffer.getvalue())

print("\n[8] Health workflow")
workflow = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "purge-check.yml").read_text()
every = re.search(r'cron: "\d+ \*/(\d+) \* \* \*"', workflow)
check("wakes a sleeping backend several times a day", every is not None and int(every.group(1)) <= 6)
check("a target never falls back to the other's settings", "matrix.target == " not in workflow)

script = textwrap.dedent(workflow.split("run: |\n", 1)[1])


def unconfigured_exit(target):
    env = {"PATH": os.environ["PATH"], "API_URL": "", "TOKEN": ""}
    body = script.replace("${{ matrix.target }}", target)
    return subprocess.run(["bash", "-c", body], env=env, capture_output=True).returncode


check("unconfigured staging only warns", unconfigured_exit("staging") == 0)
check("unconfigured production fails", unconfigured_exit("production") != 0)

if failures:
    print(f"\n{len(failures)} FAILED: {failures}")
    sys.exit(1)
print("\nAll analytics runbook tests passed.")
