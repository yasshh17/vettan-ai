"""
Benchmark script tests, with a fake pipeline. No network needed:

    python tests/test_benchmark.py
"""
import os
import sys

os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("TAVILY_API_KEY", "test")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "benchmarks"))

import asyncio  # noqa: E402
import json  # noqa: E402

import run_benchmark as bench  # noqa: E402

failures = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}{'  ' + detail if detail and not cond else ''}")
    if not cond:
        failures.append(label)


def analytics(successful=4, total=4, sources=5, cost=0.033, stage=None):
    return {"subquery_count": total, "successful_search_count": successful, "total_search_count": total,
            "selected_source_count": sources, "decomposition_latency_ms": 900, "search_latency_ms": 2000,
            "synthesis_ttft_ms": 600, "input_tokens": 2000,
            "output_tokens": 800, "estimated_cost_usd": cost, "failure_stage": stage}


def fake_stream(kind):
    async def stream(question):
        yield {"type": "stage", "phase": "decomposed", "sub_queries": ["a"]}
        if kind == "raise":
            raise RuntimeError("synthesis exploded")
        if kind == "silent":
            return
        yield {"type": "token", "text": "answer"}
        yield {"type": "final", "output": "answer",
               "citations": [{"url": "https://a.example/1", "domain": "a.example"}], "analytics": {
            "ok": analytics(),
            "partial": analytics(successful=2),
            "no_results": analytics(successful=0, sources=0, stage="search"),
        }[kind]}
    return stream


print("\n[1] One run")

bench.rp.research_stream = fake_stream("ok")
r = asyncio.run(bench.run_one("q"))
check("completed run", r["completed"] and r["failure"] is None, str(r))
check("latency and TTFT are int ms, TTFT <= latency",
      isinstance(r["latency_ms"], int) and isinstance(r["ttft_ms"], int) and r["ttft_ms"] <= r["latency_ms"], str(r))
check("pipeline counts and cost copied", (r["selected_source_count"], r["estimated_cost_usd"]) == (5, 0.033), str(r))
check("step timings saved", (r["decomposition_latency_ms"], r["synthesis_ttft_ms"]) == (900, 600), str(r))
check("answer text and source URLs saved", (r["answer"], r["sources"]) == ("answer", ["https://a.example/1"]), str(r))

bench.rp.research_stream = fake_stream("no_results")
r = asyncio.run(bench.run_one("q"))
check("pipeline failure stage -> not completed", (r["completed"], r["failure"]) == (False, "search"), str(r))

bench.rp.research_stream = fake_stream("raise")
r = asyncio.run(bench.run_one("q"))
check("exception is caught and recorded by type",
      (r["completed"], r["failure"], r["error"]) == (False, "exception", "RuntimeError"), str(r))
check("  ...with no answer and no sources", (r["answer"], r["sources"]) == (None, []), str(r))

bench.rp.research_stream = fake_stream("silent")
r = asyncio.run(bench.run_one("q"))
check("stream that never finishes -> no_final", (r["completed"], r["failure"]) == (False, "no_final"), str(r))


print("\n[2] Summary")

check("empty run: no division by zero", bench.summarize([])["completion_rate"] is None)


def row(latency, ttft, kind="ok"):
    result = {"question": "q", "latency_ms": latency, "ttft_ms": ttft, "error": None}
    result.update({k: v for k, v in {
        "ok": analytics(), "partial": analytics(successful=2, cost=0.031),
        "no_results": analytics(successful=0, sources=0, cost=0.032, stage="search"),
    }[kind].items() if k != "failure_stage"})
    stage = {"ok": None, "partial": None, "no_results": "search"}[kind]
    result.update(completed=stage is None, failure=stage)
    return result


rows = [row(10000, 5000), row(12000, 6000), row(14000, 7000, "partial"), row(30000, 9000), row(4000, 3000, "no_results")]
s = bench.summarize(rows)
check("completion 4/5", (s["completed"], s["completion_rate"]) == (4, 0.8), str(s))
check("latency over completed runs only: p50 13000, p95 27600",
      s["latency_ms"] == {"p50": 13000, "p95": 27600, "samples": 4}, str(s["latency_ms"]))
check("TTFT over completed runs only", s["ttft_ms"] == {"p50": 6500, "p95": 8700, "samples": 4}, str(s["ttft_ms"]))
check("search latency includes the failed run", s["search_latency_ms"]["samples"] == 5)
check("sources averaged over completed runs", s["avg_selected_sources"] == 5.0)
check("partial-search rate: 1 of 5 runs that searched", s["partial_search_rate"] == 0.2, str(s))
check("cost averaged over completed runs", s["avg_cost_per_completed_usd"] == round((0.033 * 3 + 0.031) / 4, 6), str(s))
check("failures grouped", s["failures"] == {"search": 1})
bench.print_summary(s)


print("\n[3] Question set")

with open(os.path.join(os.path.dirname(bench.__file__), "questions.json")) as f:
    qs = json.load(f)["questions"]
check("50 questions", len(qs) == 50, str(len(qs)))
check("no duplicates", len(set(qs)) == len(qs))

print()
if failures:
    print(f"{len(failures)} FAILED")
    sys.exit(1)
print("All benchmark tests passed.")
