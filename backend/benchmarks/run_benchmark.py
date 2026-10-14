"""
Runs a fixed question set through the research pipeline and reports latency,
time to first token, completion, sources, partial searches and cost.

    cd backend
    venv/bin/python benchmarks/run_benchmark.py            # all 50, asks first
    venv/bin/python benchmarks/run_benchmark.py --limit 3  # quick check

Calls agent.research_pipeline directly, so there's no HTTP, auth, cache,
moderation or spend guard in the numbers. Each answer and its source URLs are
saved with the numbers. See docs/benchmark.md.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import platform
import subprocess
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(HERE.parent / ".env")

from agent import research_pipeline as rp  # noqa: E402
from utils.analytics_summary import percentile  # noqa: E402

COPIED = (
    "subquery_count",
    "successful_search_count",
    "total_search_count",
    "selected_source_count",
    "decomposition_latency_ms",
    "search_latency_ms",
    "synthesis_ttft_ms",
    "input_tokens",
    "output_tokens",
    "estimated_cost_usd",
)


async def run_one(question: str) -> Dict[str, Any]:
    started = time.perf_counter()
    first_token: Optional[float] = None
    final: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    try:
        async for event in rp.research_stream(question):
            if event["type"] == "token" and first_token is None:
                first_token = time.perf_counter()
            elif event["type"] == "final":
                final = event
    except Exception as e:
        error = type(e).__name__
    finished = time.perf_counter()

    run = (final or {}).get("analytics") or {}
    if error:
        failure = "exception"
    elif final is None:
        failure = "no_final"
    else:
        failure = run.get("failure_stage")
    return {
        "question": question,
        "completed": failure is None,
        "failure": failure,
        "error": error,
        "latency_ms": round((finished - started) * 1000),
        "ttft_ms": round((first_token - started) * 1000) if first_token else None,
        **{key: run.get(key) for key in COPIED},
        "answer": (final or {}).get("output"),
        "sources": [c.get("url") for c in (final or {}).get("citations") or []],
    }


def _dist(rows: List[Dict[str, Any]], key: str) -> Dict[str, Any]:
    values = [r[key] for r in rows if r.get(key) is not None]
    p50, p95 = percentile(values, 0.5), percentile(values, 0.95)
    return {
        "p50": None if p50 is None else round(p50),
        "p95": None if p95 is None else round(p95),
        "samples": len(values),
    }


def _mean(values: List[float], digits: int) -> Optional[float]:
    return round(sum(values) / len(values), digits) if values else None


def summarize(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    done = [r for r in results if r["completed"]]
    searched = [r for r in results if (r.get("total_search_count") or 0) > 0]
    partial = [r for r in searched if 0 < (r.get("successful_search_count") or 0) < r["total_search_count"]]
    costs = [r["estimated_cost_usd"] for r in done if r.get("estimated_cost_usd") is not None]
    return {
        "questions": len(results),
        "completed": len(done),
        "completion_rate": round(len(done) / len(results), 4) if results else None,
        "latency_ms": _dist(done, "latency_ms"),
        "ttft_ms": _dist(done, "ttft_ms"),
        "search_latency_ms": _dist(results, "search_latency_ms"),
        "avg_selected_sources": _mean([r["selected_source_count"] for r in done
                                       if r.get("selected_source_count") is not None], 2),
        "partial_search_rate": round(len(partial) / len(searched), 4) if searched else None,
        "avg_cost_per_completed_usd": _mean(costs, 6),
        "cost_samples": len(costs),
        "failures": dict(Counter(r["failure"] for r in results if not r["completed"])),
    }


def _git_commit() -> Optional[str]:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=HERE, capture_output=True, text=True, check=True
        ).stdout.strip()
    except Exception:
        return None


def _seconds(ms: Optional[float]) -> str:
    return "-" if ms is None else f"{ms / 1000:.1f}s"


def print_summary(summary: Dict[str, Any]) -> None:
    lat, ttft, search = summary["latency_ms"], summary["ttft_ms"], summary["search_latency_ms"]
    rate = summary["completion_rate"]
    partial = summary["partial_search_rate"]
    cost = summary["avg_cost_per_completed_usd"]
    print(f"""
Completed            {summary['completed']}/{summary['questions']} ({'-' if rate is None else f'{rate:.0%}'})
Latency              p50 {_seconds(lat['p50'])}   p95 {_seconds(lat['p95'])}   (n={lat['samples']})
Time to first token  p50 {_seconds(ttft['p50'])}   p95 {_seconds(ttft['p95'])}   (n={ttft['samples']})
Search step          p50 {_seconds(search['p50'])}   p95 {_seconds(search['p95'])}   (n={search['samples']})
Sources per report   {summary['avg_selected_sources']}
Partial-search rate  {'-' if partial is None else f'{partial:.1%}'}
Cost per report      {'-' if cost is None else f'${cost:.4f}'}   (n={summary['cost_samples']})
Failures             {summary['failures'] or 'none'}""")


async def run_all(questions: List[str], concurrency: int) -> List[Dict[str, Any]]:
    gate = asyncio.Semaphore(concurrency)
    results: List[Optional[Dict[str, Any]]] = [None] * len(questions)

    async def one(i: int, question: str) -> None:
        async with gate:
            result = await run_one(question)
        results[i] = result
        status = "ok" if result["completed"] else result["failure"]
        print(f"  [{i + 1:>2}/{len(questions)}] {_seconds(result['latency_ms']):>6}  "
              f"sources={result['selected_source_count']}  {status:<17} {question[:50]}", flush=True)

    await asyncio.gather(*(one(i, q) for i, q in enumerate(questions)))
    return [r for r in results if r is not None]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", type=int, help="only the first N questions")
    parser.add_argument("--concurrency", type=int, default=1, help="questions in flight at once (default 1)")
    parser.add_argument("--warmup", type=int, default=1, help="uncounted runs first, to open connections (default 1)")
    parser.add_argument("--yes", action="store_true", help="skip the cost prompt")
    args = parser.parse_args()

    question_set = json.loads((HERE / "questions.json").read_text())
    questions = question_set["questions"][: args.limit]
    runs = len(questions) + args.warmup
    # Roughly 4 searches and $0.001 of gpt-4o-mini tokens per run.
    print(f"{len(questions)} questions + {args.warmup} warm-up, concurrency {args.concurrency}. "
          f"About {runs * 4} Tavily credits and ${runs * (0.001 + 4 * rp.TAVILY_USD_PER_SEARCH):.3f}.")
    if "TAVILY_USD_PER_SEARCH" not in os.environ:
        print(f"TAVILY_USD_PER_SEARCH isn't set, so costs use the ${rp.TAVILY_USD_PER_SEARCH} placeholder.")
    if not args.yes and input("Run it? [y/N] ").strip().lower() != "y":
        return

    async def go() -> List[Dict[str, Any]]:
        for _ in range(args.warmup):
            await run_one(questions[0])
        return await run_all(questions, args.concurrency)

    started_at = datetime.now(timezone.utc)
    results = asyncio.run(go())
    summary = summarize(results)
    print_summary(summary)

    out_dir = HERE / "results"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"{started_at.strftime('%Y%m%dT%H%M%SZ')}.json"
    out.write_text(json.dumps({
        "started_at": started_at.isoformat(),
        "commit": _git_commit(),
        "question_set_version": question_set["version"],
        "machine": f"{platform.system()} {platform.machine()}, Python {platform.python_version()}",
        "settings": {
            "concurrency": args.concurrency,
            "warmup": args.warmup,
            "openai_input_usd_per_1m": rp.OPENAI_INPUT_USD_PER_1M,
            "openai_output_usd_per_1m": rp.OPENAI_OUTPUT_USD_PER_1M,
            "tavily_usd_per_search": rp.TAVILY_USD_PER_SEARCH,
        },
        "summary": summary,
        "results": results,
    }, indent=2))
    print(f"\nSaved {out.relative_to(HERE.parent)}")


if __name__ == "__main__":
    main()
