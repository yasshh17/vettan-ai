-- 0010_grant_api_access.sql
--
-- New Supabase projects no longer let the API roles reach new public tables, and
-- 0000 to 0009 relied on the old default. Without this, even service_role gets 42501.
-- Every table has RLS. Only the three user tables are open to anon and authenticated.
--
-- Non-breaking, idempotent. Older projects already have these grants.

begin;

grant select, insert, update, delete
  on public.research_sessions, public.messages, public.profiles
  to anon, authenticated, service_role;

grant select, insert, update, delete
  on public.usage_daily, public.spend_daily, public.analytics_events, public.answer_feedback
  to service_role;

grant usage, select on all sequences in schema public to service_role;

commit;
