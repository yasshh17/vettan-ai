-- 0005_drop_legacy_open_policies.sql
--
-- Removes the two "Allow anon full access" policies that predate the tenant
-- isolation work and cancel out 0003_enable_rls.sql.
--
-- WHY THIS IS NEEDED
-- RLS policies are PERMISSIVE by default: a row is visible if ANY applicable
-- policy allows it. These two were created earlier (outside the repo's
-- migrations) as
--     FOR ALL  TO anon, authenticated  USING (true)
-- on research_sessions and messages. 0003 correctly adds owner-scoped policies,
-- but 0003 only drops the policies it created itself, so these survived and kept
-- both tables fully readable AND writable by anyone holding the public anon key
-- (which ships in the frontend bundle) — read, insert, update and delete.
--
-- Applying 0003 with these still present looks like success ("RLS enabled: true")
-- while changing nothing, which is how this went unnoticed.
--
-- Dropped by exact name, not by pattern: nothing else is touched. In particular
-- the owner-scoped policies on messages that reference `conversations`, and the
-- service_role policies, are left exactly as they are.
--
-- Idempotent. Apply AFTER 0003_enable_rls.sql. Before this, the only thing
-- standing between a caller and every row was the application layer.
--
-- Safe for the app: user requests carry the caller's JWT (role `authenticated`,
-- auth.uid() = their id), which is exactly what rs_* and msg_all in 0003 match.
-- Nothing in the backend relies on unauthenticated table access.

begin;

drop policy if exists "Allow anon full access" on public.research_sessions;
drop policy if exists "Allow anon full access" on public.messages;

commit;

-- Verify — expect NO row whose policyname is "Allow anon full access":
--   select tablename, policyname, cmd, roles
--     from pg_policies
--    where tablename in ('research_sessions', 'messages')
--    order by 1, 2;
--
-- Then, from anywhere, with the anon key and NO user JWT, both of these must
-- return 0 rows (they returned 10 and 20 before this migration):
--   GET {SUPABASE_URL}/rest/v1/research_sessions?select=id
--   GET {SUPABASE_URL}/rest/v1/messages?select=id
