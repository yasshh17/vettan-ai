# Research benchmark

A fixed set of 50 questions ([`backend/benchmarks/questions.json`](../backend/benchmarks/questions.json)) run through the research pipeline, so latency, completion, sources and cost can be measured the same way every time.

```bash
cd backend
venv/bin/python benchmarks/run_benchmark.py --limit 3   # quick check, about $0.13
venv/bin/python benchmarks/run_benchmark.py             # all 50, about $1.70
```

It prints the expected cost and asks before running. Each run is saved to `backend/benchmarks/results/<UTC time>.json`, with the commit, machine, settings and summary, and for every question its numbers, the full answer and the source URLs it cited. That makes answers easy to spot-check, and gives a quality evaluation something to grade. Results are git-ignored: keep the files you rely on, and put a summary in the PR when you quote them.

## What it measures

The script calls `research_stream()` directly, one question at a time after one uncounted warm-up run.

| Metric | Definition |
|---|---|
| Completion rate | Runs that produced a report: no exception, and no pipeline failure stage (`search`, `search_no_results`, `synthesis`) |
| Latency p50/p95 | From calling the pipeline to its last event, over completed runs |
| Time to first token p50/p95 | From calling the pipeline to the first answer token, over completed runs |
| Search step p50/p95 | The parallel search wave, over all runs |
| Sources per report | Mean selected sources over completed runs |
| Partial-search rate | Share of runs where some, but not all, searches succeeded |
| Cost per report | Mean estimated cost over completed runs: tokens × OpenAI price + searches × `TAVILY_USD_PER_SEARCH` |

## What it leaves out

- **HTTP, auth, moderation, the cache and saving to the database.** Production latency through the API is a little higher; compare with the analytics summary once there's traffic.
- **Cache hit rate.** That depends on how often real users repeat questions, which a fixed question set can't tell you. The cache's speedup can be read from production analytics instead (`cache_hit` vs `research_completed` latency).
- **Network.** Runs from a laptop go over home internet to OpenAI and Tavily, not from Render's data centre.

## Quoting results

Say where a number came from, for example: "p95 latency of *X* s across a fixed 50-question benchmark (gpt-4o-mini, run on *date*)". Keep the results file. Costs use list prices (`OPENAI_*_USD_PER_1M`, `TAVILY_USD_PER_SEARCH`), so they don't depend on a free tier. Check the Tavily price against its pricing page before quoting cost; the default is a placeholder.
