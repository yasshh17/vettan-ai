-- 0002_backfill_legacy_sessions.sql
--
-- Claims the sessions that were created before authentication existed.
--
-- These rows have user_id NULL because the column did not exist when they were
-- written, so there is no owner recorded in the data to recover. They are the
-- developer's own pre-auth research; the only other account on this project was
-- created later, during the tenant-isolation work, as a test account.
--
-- Without this, 0003 makes every one of those rows invisible to every account
-- (user_id = auth.uid() is NULL-false), which reads as data loss.
--
-- Idempotent: only touches rows that still have no owner, so re-running it can
-- never reassign a session that a real user already owns.
--
-- Apply AFTER 0001_add_user_id.sql and BEFORE 0003_enable_rls.sql.

begin;

do $$
declare
  legacy_owner constant uuid := '8dde29a5-1350-45d5-9039-5830f81065f6';  -- yasshh17@gmail.com
  claimed int;
begin
  if not exists (select 1 from auth.users where id = legacy_owner) then
    raise exception
      'Legacy owner % does not exist in auth.users - update this migration before running it',
      legacy_owner;
  end if;

  update public.research_sessions
     set user_id = legacy_owner
   where user_id is null;

  get diagnostics claimed = row_count;
  raise notice 'Assigned % pre-auth session(s) to %', claimed, legacy_owner;
end $$;

commit;

-- Verify (expect 0):
--   select count(*) from public.research_sessions where user_id is null;
