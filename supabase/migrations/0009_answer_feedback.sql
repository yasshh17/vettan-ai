-- 0009_answer_feedback.sql
--
-- Thumbs up/down on answers, for PUT /api/feedback. No text. Service role only.
--
-- Non-breaking, idempotent.

begin;

create table if not exists public.answer_feedback (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Set null, not cascade, like analytics_events.
  user_id     uuid references auth.users(id) on delete set null,
  session_id  uuid not null,
  message_id  uuid not null,
  rating      text not null check (rating in ('up', 'down')),
  is_followup boolean not null default false,
  unique (user_id, message_id)
);

create index if not exists idx_af_created_at
  on public.answer_feedback (created_at);

alter table public.answer_feedback enable row level security;

-- No policies on purpose; the service role bypasses RLS.
revoke all on public.answer_feedback from anon, authenticated;

commit;

-- The anon key must get "permission denied" from GET /rest/v1/answer_feedback.
