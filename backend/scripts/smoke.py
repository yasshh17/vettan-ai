"""
Post-deploy smoke test: sign in, ask one real question, ask a follow-up, check history.

Run by .github/workflows/smoke.yml against staging, or by hand:
    API_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... SMOKE_EMAIL=... SMOKE_PASSWORD=... \
        python scripts/smoke.py

EXPECT_COMMIT (optional) makes it wait until /health reports that commit, so it
tests the new deploy rather than the old one. Exits 1 on the first failure.
"""
from __future__ import annotations

import json
import os
import sys
import time
from typing import Dict, Iterable, List, Optional, Tuple

import httpx

QUESTION = "What is the James Webb Space Telescope and what has it discovered so far?"
FOLLOWUP = "Summarize that in one sentence."

# Free Render instances sleep when idle and take about a minute to wake.
DEPLOY_WAIT_SECONDS = 15 * 60
STREAM_TIMEOUT = httpx.Timeout(120.0, connect=90.0)


class SmokeFailure(Exception):
    pass


def check(condition: bool, message: str) -> None:
    if not condition:
        raise SmokeFailure(message)


def parse_sse(lines: Iterable[str]) -> List[Tuple[str, Dict]]:
    """(event, data) pairs from SSE lines."""
    events: List[Tuple[str, Dict]] = []
    event, data = "message", []
    for line in lines:
        if line == "":
            if data:
                events.append((event, json.loads("\n".join(data))))
            event, data = "message", []
        elif line.startswith("event:"):
            event = line[len("event:"):].strip()
        elif line.startswith("data:"):
            data.append(line[len("data:"):].strip())
    if data:
        events.append((event, json.loads("\n".join(data))))
    return events


def wait_for_deploy(client: httpx.Client, api: str, commit: Optional[str]) -> Dict:
    deadline = time.monotonic() + DEPLOY_WAIT_SECONDS
    last: object = None
    while time.monotonic() < deadline:
        try:
            response = client.get(f"{api}/health", timeout=90.0)
            last = response.json() if response.status_code == 200 else response.status_code
            if (
                isinstance(last, dict)
                and last.get("status") == "healthy"
                and (not commit or last.get("commit") == commit)
            ):
                return last
        except (httpx.HTTPError, ValueError) as exc:
            last = repr(exc)
        time.sleep(15)
    wanted = f"commit {commit[:12]}" if commit else "healthy"
    raise SmokeFailure(f"/health never reported {wanted} within {DEPLOY_WAIT_SECONDS // 60} min; last: {last}")


def sign_in(client: httpx.Client, supabase_url: str, anon_key: str, email: str, password: str) -> str:
    response = client.post(
        f"{supabase_url}/auth/v1/token",
        params={"grant_type": "password"},
        headers={"apikey": anon_key},
        json={"email": email, "password": password},
    )
    check(response.status_code == 200, f"sign-in returned {response.status_code}: {response.text[:200]}")
    return response.json()["access_token"]


def ask(client: httpx.Client, api: str, token: str, body: Dict) -> Tuple[List[Tuple[str, Dict]], float]:
    """Stream one request; returns the events and seconds to the first token."""
    started = time.monotonic()
    first_token: Optional[float] = None
    lines: List[str] = []
    with client.stream(
        "POST",
        f"{api}/api/research/stream",
        json=body,
        headers={"Authorization": f"Bearer {token}"},
        timeout=STREAM_TIMEOUT,
    ) as response:
        check(response.status_code == 200, f"stream returned {response.status_code}: {response.read()[:200]!r}")
        for line in response.iter_lines():
            if first_token is None and line.startswith("event: token"):
                first_token = time.monotonic() - started
            lines.append(line)
    events = parse_sse(lines)
    names = [name for name, _ in events]
    problems = [data for name, data in events if name in ("error", "blocked")]
    check(not problems, f"stream sent {problems}")
    check("token" in names, f"no answer text streamed; events: {names}")
    check(names[-1] == "done", f"stream didn't finish with done; events: {names}")
    return events, first_token or 0.0


def run(
    report: List[str],
    client: httpx.Client,
    api: str,
    supabase_url: str,
    anon_key: str,
    email: str,
    password: str,
    commit: Optional[str],
) -> None:
    health = wait_for_deploy(client, api, commit)
    report.append(f"health: {health.get('status')}, commit {str(health.get('commit'))[:12]}")

    token = sign_in(client, supabase_url, anon_key, email, password)
    report.append("sign-in: ok")
    auth = {"Authorization": f"Bearer {token}"}

    # use_cache off so the whole pipeline runs, not a stored answer.
    events, ttft = ask(client, api, token, {"query": QUESTION, "use_cache": False})
    sources = next((data for name, data in events if name == "sources"), None)
    check(bool(sources and sources.get("citations")), "research returned no sources")
    session_id = events[-1][1].get("session_id")
    check(bool(session_id), "done event has no session_id")
    report.append(f"research: {len(sources['citations'])} sources, first word after {ttft:.1f}s")

    try:
        _, ttft = ask(client, api, token, {"query": FOLLOWUP, "session_id": session_id, "is_followup": True})
        report.append(f"follow-up: first word after {ttft:.1f}s")

        history = client.get(f"{api}/api/history", headers=auth)
        check(history.status_code == 200, f"history returned {history.status_code}")
        ids = [s["id"] for s in history.json().get("sessions", [])]
        check(session_id in ids, "new conversation missing from history")

        messages = client.get(f"{api}/api/history/{session_id}/messages", headers=auth)
        check(messages.status_code == 200, f"messages returned {messages.status_code}")
        count = messages.json().get("count", 0)
        check(count >= 4, f"expected 4 saved messages, found {count}")
        report.append(f"history: conversation saved with {count} messages")
    finally:
        client.delete(f"{api}/api/history/{session_id}", headers=auth)


def main() -> int:
    names = ("API_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY", "SMOKE_EMAIL", "SMOKE_PASSWORD")
    missing = [name for name in names if not os.getenv(name, "").strip()]
    if missing:
        print(f"Missing settings: {', '.join(missing)}")
        return 1
    env = {name: os.environ[name].strip().rstrip("/") for name in names}
    commit = os.getenv("EXPECT_COMMIT", "").strip() or None

    report: List[str] = []
    try:
        with httpx.Client(timeout=30.0) as client:
            run(
                report, client, env["API_URL"], env["SUPABASE_URL"], env["SUPABASE_ANON_KEY"],
                env["SMOKE_EMAIL"], env["SMOKE_PASSWORD"], commit,
            )
        ok = True
    except (SmokeFailure, httpx.HTTPError) as exc:
        report.append(f"FAILED: {exc}")
        ok = False

    print("\n".join(report))
    summary = os.getenv("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write(f"### Staging smoke test: {'passed' if ok else 'failed'}\n\n")
            f.write("".join(f"- {line}\n" for line in report))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
