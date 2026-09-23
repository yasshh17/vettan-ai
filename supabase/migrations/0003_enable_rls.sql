-- 0003_enable_rls.sql
--
-- Database-layer backstop. The application layer is now the primary enforcement,
-- but this holds even if a future query forgets its .eq('user_id', ...).
--
-- *** BREAKING — APPLY ONLY AFTER the backend that forwards the caller's JWT
-- *** is deployed and verified. Until the backend attaches an Authorization
-- *** header to its PostgREST requests, auth.uid() is NULL and every query
-- *** returns empty.
--
-- This also closes the direct-database bypass: the anon key is public by design
-- (it ships in the frontend JS bundle), and today it can read these tables
-- straight from the PostgREST endpoint, going around the API entirely.

begin;

alter table public.research_sessions enable row level security;
alter table public.messages          enable row level security;

-- Drop first so this migration is re-runnable.
drop policy if exists rs_select on public.research_sessions;
drop policy if exists rs_insert on public.research_sessions;
drop policy if exists rs_update on public.research_sessions;
drop policy if exists rs_delete on public.research_sessions;
drop policy if exists msg_all   on public.messages;

-- ---------------------------------------------------------------------------
-- research_sessions
--
-- `user_id = auth.uid()` evaluates to NULL (not true) for legacy rows, so the
-- unattributed backlog is invisible to everyone. That is intentional.
-- ---------------------------------------------------------------------------

create policy rs_select on public.research_sessions
  for select using (user_id = auth.uid());

create policy rs_insert on public.research_sessions
  for insert with check (user_id = auth.uid());

create policy rs_update on public.research_sessions
  for update using (user_id = auth.uid())
          with check (user_id = auth.uid());

create policy rs_delete on public.research_sessions
  for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- messages
--
-- Ownership is derived from the parent session rather than denormalised onto
-- the row, so the two can never drift out of sync. idx_messages_session_id
-- (0001) plus the research_sessions PK keep the EXISTS cheap. If this ever
-- shows up in query plans, denormalise user_id onto messages and revisit.
-- ---------------------------------------------------------------------------

create policy msg_all on public.messages
  for all
  using (
    exists (
      select 1 from public.research_sessions s
      where s.id = messages.session_id
        and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.research_sessions s
      where s.id = messages.session_id
        and s.user_id = auth.uid()
    )
  );

commit;

-- Verify (expect 0 rows, run with the anon key and no user JWT):
--   select count(*) from public.research_sessions;
