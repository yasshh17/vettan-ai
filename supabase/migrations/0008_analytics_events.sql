-- 0008_analytics_events.sql
--
-- One row per research or follow-up request, for backend/utils/analytics.py.
-- Numbers only, no query or answer text. Service role only.
--
-- Non-breaking, idempotent. Safe to apply before or after the backend deploy.

begin;

create table if not exists public.analytics_events (
  id                       bigint generated always as identity primary key,
  created_at               timestamptz not null default now(),
  -- Set null, not cascade: a deleted account's rows become anonymous counts.
  user_id                  uuid references auth.users(id) on delete set null,
  session_id               uuid,

  event_type               text    not null check (event_type in (
                             'research_completed', 'research_failed', 'cache_hit',
                             'followup_completed', 'followup_failed')),
  request_type             text    not null check (request_type in ('research', 'followup')),
  success                  boolean not null,
  failure_stage            text    check (failure_stage in (
                             'decomposition', 'search', 'search_no_results', 'synthesis',
                             'moderation_output', 'history', 'pipeline',
                             'client_disconnect', 'internal')),
  cache_hit                boolean not null default false,

  total_latency_ms         integer check (total_latency_ms >= 0),
  ttft_ms                  integer check (ttft_ms >= 0),
  decomposition_latency_ms integer check (decomposition_latency_ms >= 0),
  search_latency_ms        integer check (search_latency_ms >= 0),
  synthesis_latency_ms     integer check (synthesis_latency_ms >= 0),

  subquery_count           integer check (subquery_count >= 0),
  successful_search_count  integer check (successful_search_count >= 0),
  total_search_count       integer check (total_search_count >= 0),
  selected_source_count    integer check (selected_source_count >= 0),

  estimated_cost_usd       numeric(12, 6) check (estimated_cost_usd >= 0),

  metadata                 jsonb not null default '{}'::jsonb
                             check (jsonb_typeof(metadata) = 'object'
                                    and pg_column_size(metadata) <= 2048),

  constraint analytics_events_stage_matches_success
    check ((success and failure_stage is null) or (not success and failure_stage is not null))
);

create index if not exists idx_ae_created_at
  on public.analytics_events (created_at);
create index if not exists idx_ae_user_created
  on public.analytics_events (user_id, created_at);
create index if not exists idx_ae_event_created
  on public.analytics_events (event_type, created_at);
create index if not exists idx_ae_request_created
  on public.analytics_events (request_type, created_at);

alter table public.analytics_events enable row level security;

-- No policies on purpose; the service role bypasses RLS.
revoke all on public.analytics_events from anon, authenticated;

commit;

-- The anon key must get "permission denied" from GET /rest/v1/analytics_events.
