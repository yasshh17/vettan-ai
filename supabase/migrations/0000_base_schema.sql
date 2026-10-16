-- 0000_base_schema.sql
--
-- The two original tables, which were created in the dashboard before migrations
-- existed. Written from production's live columns (2026-10-16) so a fresh project
-- (staging) can be built from migrations alone. A no-op on production.
--
-- Matches production as-is, including research_sessions.created_at having no
-- time zone. Leaves out the unused, empty legacy tables conversations and
-- audio_cache, and messages.conversation_id.
--
-- Fresh project: run 0000, 0001, then 0003 onwards. Skip 0002 (it claims
-- pre-auth rows for one production account and raises if that account is missing).

begin;

create table if not exists public.research_sessions (
  id          uuid primary key default gen_random_uuid(),
  query       text not null,
  query_hash  text,
  report      text not null,
  citations   jsonb,
  metadata    jsonb,
  created_at  timestamp without time zone default now(),
  is_favorite boolean default false,
  updated_at  timestamp with time zone default now()
);

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  -- No FK here: 0001 adds messages_session_id_fkey with on delete cascade,
  -- and skips it if a constraint of that name already exists.
  session_id uuid not null,
  role       text not null constraint messages_role_check check (role in ('user', 'assistant')),
  content    text not null,
  citations  jsonb,
  metadata   jsonb,
  created_at timestamp with time zone default now()
);

commit;
