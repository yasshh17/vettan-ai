"""
get_admin_client() lazy-singleton tests.

Same shape as test_rate_limit.py — no pytest dependency, run it directly:

    python tests/test_supabase_admin_client.py

get_admin_client() is a process-lifetime singleton (backend/database/
supabase_admin_client.py). The one behavior worth pinning down: a FAILED
initialization must NOT be cached, or the account-deletion endpoint gets
permanently wedged at 503 for the life of the worker process after any single
init hiccup (missing env var at boot, create_client() raising transiently),
with no way to recover short of a full restart. A SUCCESSFUL initialization
must still be cached, so we don't rebuild the client on every call.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import supabase_admin_client as admin_mod  # noqa: E402

failures = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


def reset():
    """Process-lifetime globals must be reset explicitly between cases."""
    admin_mod._admin_client = None
    admin_mod._admin_client_initialized = False


class FakeClient:
    pass


print("\n[1] A failed init is retried, not cached forever")

reset()
os.environ["SUPABASE_URL"] = "https://example.supabase.co"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "dummy-key"

calls = []
sentinel = FakeClient()


def flaky_create_client(url, key):
    calls.append((url, key))
    if len(calls) == 1:
        raise ConnectionError("simulated transient failure")
    return sentinel


admin_mod.create_client = flaky_create_client

first = admin_mod.get_admin_client()
check("first call fails and returns None", first is None, str(first))
check("  create_client was invoked once", len(calls) == 1, str(len(calls)))

second = admin_mod.get_admin_client()
check("second call retries and succeeds", second is sentinel, str(second))
check("  create_client was invoked again (not memoized as permanently failed)",
      len(calls) == 2, str(len(calls)))

third = admin_mod.get_admin_client()
check("third call returns the cached client without re-invoking create_client",
      third is sentinel and len(calls) == 2, f"calls={len(calls)}")


print("\n[2] Missing config is also retried once fixed, no restart needed")

reset()
os.environ["SUPABASE_URL"] = ""
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = ""

calls2 = []
sentinel2 = FakeClient()


def create_client_2(url, key):
    calls2.append((url, key))
    return sentinel2


admin_mod.create_client = create_client_2

missing = admin_mod.get_admin_client()
check("unconfigured call returns None", missing is None, str(missing))
check("  create_client is never called when config is missing", len(calls2) == 0, str(len(calls2)))

os.environ["SUPABASE_URL"] = "https://example.supabase.co"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "dummy-key"

fixed = admin_mod.get_admin_client()
check("next call succeeds once env vars are set, no restart required",
      fixed is sentinel2, str(fixed))


print("\n[3] A successful client is still memoized (no regression)")

reset()
os.environ["SUPABASE_URL"] = "https://example.supabase.co"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "dummy-key"

calls3 = []
sentinel3 = FakeClient()


def create_client_3(url, key):
    calls3.append((url, key))
    return sentinel3


admin_mod.create_client = create_client_3

for _ in range(5):
    admin_mod.get_admin_client()
check("create_client is invoked exactly once across 5 calls", len(calls3) == 1, str(len(calls3)))


print("\n" + "=" * 60)
if failures:
    print(f"FAILED ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("All supabase admin client checks passed.")
