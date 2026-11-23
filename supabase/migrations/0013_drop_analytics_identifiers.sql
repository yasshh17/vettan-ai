-- 0013_drop_analytics_identifiers.sql
--
-- Drops the account and chat ids that analytics_events kept from before 0011.
-- Apply after the backfill. Irreversible: backends older than 0011 write these
-- columns, so production can't roll back past the analytics release.

begin;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'analytics_events' and column_name = 'user_id'
  ) then
    -- Nested, so this is only planned while the column exists.
    if exists (
      select 1 from public.analytics_events a
      join public.analytics_consent c on c.user_id = a.user_id and c.granted
      where a.actor_id is null
    ) then
      raise exception 'a consenting person still has unlinked rows: run the backfill first';
    end if;
  end if;
end;
$$;

-- Reads user_id, so it can't outlive the column.
drop function if exists public.backfill_analytics_actors(jsonb, text);

alter table public.analytics_events
  drop column if exists user_id,
  drop column if exists session_id;

commit;
