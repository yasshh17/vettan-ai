# Product analytics

Vettan records one row per research or follow-up request in
`public.analytics_events`. The admin summary endpoint turns those rows into
7-day and 30-day metrics. No third-party analytics service is involved; the data
stays in your Supabase project.

- Writer: [`backend/utils/analytics.py`](../backend/utils/analytics.py)
- Summary: [`backend/utils/analytics_summary.py`](../backend/utils/analytics_summary.py)
- Migrations: [`0008_analytics_events.sql`](../supabase/migrations/0008_analytics_events.sql), [`0009_answer_feedback.sql`](../supabase/migrations/0009_answer_feedback.sql)
- Tests: [`test_analytics.py`](../backend/tests/test_analytics.py), [`test_feedback.py`](../backend/tests/test_feedback.py)

## Setup

1. **Apply the migrations.** In the Supabase SQL editor, run
   `0008_analytics_events.sql`, then `0009_answer_feedback.sql`. Both are
   idempotent and non-breaking. Until 0008 exists, analytics writes log a
   warning and are dropped. Until 0009 exists, the thumbs return 500 and the
   summary shows `feedback: null`.
2. **Check that it is closed to clients.** With the anon key and no user JWT,
   this must return `permission denied` or `[]`:

   ```bash
   curl "$SUPABASE_URL/rest/v1/analytics_events?select=id&limit=1" \
     -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
   ```

   `python tests/test_analytics.py` runs the same check when
   `ANALYTICS_LIVE_RLS_CHECK=1`, `ANALYTICS_LIVE_SUPABASE_URL` and
   `ANALYTICS_LIVE_SUPABASE_ANON_KEY` are set.
3. **Configure the backend** (on Render, under Environment):

   | Variable | Default | Purpose |
   |---|---|---|
   | `SUPABASE_SERVICE_ROLE_KEY` | — | Required. Analytics writes and reads use the service role, the same client as the spend guard. Without it, nothing is recorded and the summary returns 503. |
   | `ANALYTICS_ADMIN_USER_IDS` | empty | Comma-separated Supabase auth user ids (UUIDs) allowed to read the summary. Empty means nobody can. Find your id under Authentication → Users. |
   | `ANALYTICS_ENABLED` | `true` | `false` stops all recording. |
   | `OPENAI_INPUT_USD_PER_1M` | `0.15` | gpt-4o-mini input price, used for the cost estimate. |
   | `OPENAI_OUTPUT_USD_PER_1M` | `0.60` | gpt-4o-mini output price. |
   | `TAVILY_USD_PER_SEARCH` | `0.008` | Price of one basic search (1 credit). **Set this to your plan's real per-credit price.** The default is a placeholder, not a verified figure for your account. |

4. **Read the summary** as a listed admin:

   ```bash
   curl "$API_URL/api/admin/analytics/summary?days=7" -H "Authorization: Bearer $ACCESS_TOKEN"
   ```

   `days` is between 1 and 90; use 7 or 30 for the standard periods. A non-admin gets
   `403` and a `[Security] admin_denied` log line.

## Access control

Migration 0008 follows the service-role-only pattern of `usage_daily` in
migration 0006. RLS is enabled, every privilege is revoked from `anon` and
`authenticated`, and no policies exist. As a result:

- No client can read any row through PostgREST, including the user's own rows.
- No client can insert rows, so users can't skew the metrics.
- Only the backend, using the service role, reads and writes. It returns
  aggregates only, never rows or user ids.

## What is and isn't stored

Each row holds the user's UUID, the session UUID, an event type, a failure
stage, timings in milliseconds, counts, an estimated cost and a small metadata
object. Metadata keys are allowlisted: `transport`, `pipeline`,
`decomposition_fallback`, `synthesis_ttft_ms`, `input_tokens`, `output_tokens`
and `cost_partial`. String values must come from a fixed set.

The following are **never stored**: query text, sub-queries, report or answer
text, conversation history, source URLs or titles, emails, IP addresses and access tokens.
`build_event()` drops any metric or metadata it doesn't recognise. The tests
send marker strings through every endpoint path and fail if any of them
reaches a row.

When an account is deleted, `user_id` is set to null. The row stays as an
anonymous count, and it stops counting toward daily active users.

## Events

| `event_type` | When |
|---|---|
| `research_completed` | A fresh pipeline run returned a report. |
| `research_failed` | A fresh pipeline run produced no usable report. See the stages below. |
| `cache_hit` | A stored report was served instead of running the pipeline. |
| `followup_completed` | A follow-up returned an answer. |
| `followup_failed` | A follow-up produced no usable answer. |

Requests turned away **before any paid work starts** are not recorded: the
rate limit, the in-flight cap, input moderation, the spend cap and the schema
check. These are policy decisions, not failures, and they already have
`[Security]` audit lines.

| `failure_stage` | Meaning |
|---|---|
| `search` | Every search call failed, so there were no sources. The user still gets a 200 response saying no results were found. |
| `search_no_results` | Searches succeeded but returned no sources. The response is the same as for `search`. |
| `synthesis` | The LLM step raised an error, returned an error string with a 200 response, or returned empty text. |
| `decomposition` | The streaming pipeline raised an error before sub-queries were produced. |
| `moderation_output` | The generated answer was withheld by output moderation. |
| `history` | Follow-up only: the conversation was not found or not owned, or the database was unavailable. |
| `pipeline` | The non-streaming pipeline raised an error. It runs as a single call, so the exact step is unknown. |
| `client_disconnect` | The client closed the stream before it finished. |
| `internal` | Any other error after work had started. |

## Metric definitions

All windows are **the last N UTC calendar days, including today so far**, so
`days=7` on a Wednesday covers Thursday 00:00 UTC to now.

| Metric | Definition |
|---|---|
| `research.total_requests` | `research_completed` + `research_failed` + `cache_hit` |
| `research.completed_requests` | `research_completed` + `cache_hit` |
| `research.completion_rate` | completed ÷ total |
| `research.pipeline_completion_rate` | `research_completed` ÷ (`research_completed` + `research_failed`), which excludes cache hits |
| `research.cache_hit_rate` | `cache_hit` ÷ total |
| `research.latency_ms` | Median and p95 of `total_latency_ms` over `research_completed`. This is end to end: from the moment the endpoint handler starts until the answer is ready to send. It includes moderation, the cache check, the pipeline and the save. |
| `research.ttft_ms` | Median and p95 time from handler start until the server sends the first answer token. Streaming `research_completed` only, so non-streaming requests have none. Measured on the server, so it excludes network time and the frontend's rendering. The frontend buffers tokens on a timer, and browsers slow timers in background tabs, so text can appear on screen a second or more later. |
| `research.search_latency_ms` | Median and p95 time for the parallel search wave, over both completed and failed fresh runs. |
| `research.avg_successful_searches`, `avg_total_searches`, `avg_selected_sources`, `avg_subqueries` | Means over `research_completed` |
| `research.partial_search_rate` | Share of fresh runs where some, but not all, searches succeeded |
| `research.avg_cost_per_completed_usd` | Mean `estimated_cost_usd` over `research_completed` rows that have a cost. `cost_samples` gives the count. Cache hits cost nothing and are excluded. |
| `total_estimated_cost_usd` | Sum of the estimated cost over every event, including failed runs and follow-ups |
| `followups.completion_rate` | `followup_completed` ÷ (`followup_completed` + `followup_failed`) |
| `followups.latency_ms`, `followups.ttft_ms` | The same as for research, over `followup_completed` |
| `failures_by_stage` | Count of failed events by stage, split into `research` and `followup` |
| `daily[].requests` | Every event that UTC day |
| `daily[].active_users` | Distinct non-null `user_id`s with at least one event that UTC day |

Percentiles use linear interpolation, the same method as Postgres
`percentile_cont`. Every distribution reports `samples`. A rate with a
denominator of zero is `null`, not `0`.

### Cost

`estimated_cost_usd` is computed per request from measured usage:
`input_tokens × input price + output_tokens × output price + Tavily searches × search price`.

- Token counts come from OpenAI's `usage` field. Streaming calls ask for it with
  `stream_options.include_usage`.
- Every *attempted* Tavily search is counted, because one cut off at the 6 s
  deadline may still be billed. This makes the Tavily share an upper bound.
- If an LLM call finished without reporting usage, the cost is `null` rather
  than an undercount.
- **Requests that end mid-stream** (`client_disconnect`, or an error during
  synthesis) record the counts and cost reached so far: decomposition tokens,
  plus searches once the search step has finished. They are flagged
  `metadata.cost_partial = true`. The synthesis call is left out entirely:
  OpenAI reports a stream's usage only at its end, so neither its prompt
  (about 2,000 tokens) nor the text generated before the stop is counted.
  These costs are therefore a lower bound, typically by under $0.001 with
  gpt-4o-mini, because searches dominate. They count toward
  `total_estimated_cost_usd`, but not toward `avg_cost_per_completed_usd`,
  which covers completed reports only.
- Moderation calls are free and are not included.
- The result is only as accurate as the three price variables. Check them
  against your OpenAI and Tavily invoices.

## Answer feedback

Each finished answer has a thumbs up and a thumbs down. Clicking the selected
one again clears it. `PUT /api/feedback` stores one row per user per answer in
`answer_feedback`: the user, session and message ids, the rating, and whether
it was a follow-up. No text. Only the owner of the session can vote on or read
its ratings.

| Metric | Definition |
|---|---|
| `feedback.ratings`, `up`, `down` | Votes cast in the window (by `created_at` of the vote) |
| `feedback.up_rate` | `up` ÷ `ratings`; also split into `research_up_rate` and `followup_up_rate` |
| `feedback.ratings_per_answer` | Votes ÷ completed answers (research, cache hits and follow-ups) in the window. It can pass 1.0 when people rate older answers. |

People mostly vote when something is very good or very bad, so `up_rate` is
not an accuracy score. Watch how it moves over time, and read it next to
`ratings_per_answer`.

A cached answer comes back with ids that aren't saved, so its vote is counted
but doesn't show again after a reload.

## Retention

Computed from `analytics_events`; nothing extra is tracked. A user's first-seen
day is their earliest event in the last 90 days.

| Metric | Definition |
|---|---|
| `retention.dN.eligible` | Users first seen at least N days ago (N = 1, 7, 30) |
| `retention.dN.retained` | Of those, users active again within N days of their first day |
| `retention.dN.rate` | `retained` ÷ `eligible` |
| `retention.new_users` | Users first seen inside the summary window |

Analytics started on 2026-10-12, so d1 needs a day of data, d7 a week and d30 a
month before they mean anything. Anyone inactive for more than 90 days and
then back is counted as new.

## Known caveats

- **Stream fallback double counts.** When the stream sends an `error` event,
  the frontend retries on `/api/research`. One user action can then produce a
  failed stream event and a completed non-streaming event. `metadata.transport`
  tells the two apart.
- **Retries are separate events.** Asking the same question twice gives two
  events, or one fresh run and one cache hit.
- **Truncation.** The summary reads at most 200,000 rows and sets
  `truncated: true` beyond that. At that volume, move the aggregation into SQL.
- **Dropped events.** If the database is slow, or analytics is unavailable,
  events are dropped and a warning is logged. This happens past 256 queued
  writes per process. Requests are never slowed down to save an event.
  Counts are therefore a lower bound during an outage.

## Using these numbers in a résumé, README or pitch

Only quote figures that come from **real collected data** or a **repeatable benchmark**:

- **Collected data:** state the window, the sample size and the source, for
  example "median end-to-end latency *X* s, p95 *Y* s, over *N* completed
  research requests, 30 days to *date*, from production analytics." Small
  samples, such as a week of your own testing, are not representative usage.
  Say so, or don't quote them.
- **Benchmark:** a fixed, published query set run against a stated
  environment and commit, with a script anyone can rerun.
- **Never quote** the default prices, the spend-guard reservation amounts
  (`COST_RESEARCH_USD` and similar) or numbers from this document as measured
  results. Costs are estimates derived from token counts and configured
  prices, so present them as estimates.
