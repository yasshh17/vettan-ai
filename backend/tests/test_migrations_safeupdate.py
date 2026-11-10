"""
Supabase loads pg-safeupdate for API requests, which rejects DELETE and UPDATE without
a WHERE clause, even inside a function. Plain Postgres doesn't, so the SQL tests can't
catch it. Checks the latest definition of every function in the migrations.

    python tests/test_migrations_safeupdate.py
"""
import re
import sys
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parents[2] / "supabase" / "migrations"

failures = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


FUNCTION = re.compile(
    r"create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(\w+)\s*\(.*?\$(\w*)\$(.*?)\$\2\$",
    re.IGNORECASE | re.DOTALL,
)
STATEMENT = re.compile(r"\b(delete\s+from|update)\s+[^;]*?;", re.IGNORECASE | re.DOTALL)


def strip_comments(sql):
    return re.sub(r"--[^\n]*", "", sql)


def unguarded(body):
    """DELETE or UPDATE statements in a function body with no WHERE clause."""
    found = []
    body = strip_comments(body)
    for m in STATEMENT.finditer(body):
        text = m.group(0)
        # "on conflict ... do update" is part of an insert, which safeupdate allows.
        if re.search(r"\bdo\s*$", body[:m.start()], re.IGNORECASE):
            continue
        if not re.search(r"\bwhere\b", text, re.IGNORECASE):
            found.append(" ".join(text.split()))
    return found


latest = {}
for path in sorted(MIGRATIONS.glob("*.sql")):
    for m in FUNCTION.finditer(path.read_text()):
        latest[m.group(1)] = (path.name, m.group(3))

print("\nEvery function's DELETE and UPDATE has a WHERE clause")
check("found functions to check", len(latest) > 10, str(len(latest)))
for name, (source, body) in sorted(latest.items()):
    bad = unguarded(body)
    check(f"{name} ({source})", not bad, "; ".join(bad))

print("\nThe checker itself")
check("flags a bare delete", unguarded("begin delete from t; end") == ["delete from t;"])
check("allows delete ... where true", unguarded("begin delete from t where true; end") == [])
check("ignores a comment", unguarded("begin -- delete from t;\n end") == [])
check("ignores select ... for update", unguarded("begin select 1 into x from t where a for update; end") == [])
check("ignores on conflict do update", unguarded("begin insert into t values (1) on conflict (a) do update set b = 1; end") == [])
check("flags a bare update", unguarded("begin update t set a = 1; end") == ["update t set a = 1;"])

print("\n" + "=" * 60)
if failures:
    print(f"FAILED ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("All migration safeupdate checks passed.")
