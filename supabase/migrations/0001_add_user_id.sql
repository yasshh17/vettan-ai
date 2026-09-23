-- 0001_add_user_id.sql
--
-- Adds the tenant dimension that research_sessions/messages never had.
--
-- NON-BREAKING. Apply this BEFORE deploying the application-layer changes.
-- Existing rows get user_id = NULL. They are deliberately left unattributed:
-- there is no recoverable owner for them, and 0002 makes NULL-owned rows
-- invisible to every account.

begin;

-- ---------------------------------------------------------------------------
-- 1. Tenant column
-- ---------------------------------------------------------------------------

alter table public.research_sessions
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- 2. Parent/child cascade on messages
--
-- delete_session() currently deletes messages by hand in a separate statement.
-- A real FK makes that correct-by-construction and, combined with the
-- auth.users cascade above, finally makes account deletion remove a user's
-- research (the gap admitted in backend/main.py's delete_account docstring).
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where constraint_name = 'messages_session_id_fkey'
      and table_name = 'messages'
      and table_schema = 'public'
  ) then
    -- Drop orphans first, or the constraint cannot be validated.
    delete from public.messages m
    where not exists (
      select 1 from public.research_sessions s where s.id = m.session_id
    );

    alter table public.messages
      add constraint messages_session_id_fkey
      foreign key (session_id)
      references public.research_sessions(id)
      on delete cascade;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Indexes for the access patterns the app-layer fix introduces
-- ---------------------------------------------------------------------------

-- get_recent_sessions: where user_id = ? order by updated_at desc
create index if not exists idx_rs_user_updated
  on public.research_sessions (user_id, updated_at desc);

-- check_cache: where user_id = ? and query_hash = ?
create index if not exists idx_rs_user_query_hash
  on public.research_sessions (user_id, query_hash);

-- messages RLS policy does an EXISTS join back on session_id
create index if not exists idx_messages_session_id
  on public.messages (session_id);

commit;
