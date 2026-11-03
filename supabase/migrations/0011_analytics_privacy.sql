-- 0011_analytics_privacy.sql
--
-- Consent-based product analytics. Consent is checked here, at write time, so a
-- withdrawal takes effect at once whatever is queued or running in the backend.
-- Everything is service role only. Rules: docs/analytics.md, runbooks:
-- docs/analytics-operations.md.
--
-- Non-breaking, idempotent. Apply before deploying the backend.

begin;

create table if not exists public.analytics_consent (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  granted              boolean not null,
  decided_at           timestamptz not null default now(),
  wording_version      text not null,
  source               text not null check (source in ('signup', 'prompt', 'settings')),
  -- Set when a withdrawal's erase finishes; cleared once the person has seen the notice.
  erasure_completed_at timestamptz
);

-- A pending row is the only thing that keeps the account, and with it the user id
-- the erase needs. The trigger below holds that line for any delete, cascades included.
create table if not exists public.analytics_erasure_requests (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  kind            text not null check (kind in ('withdrawal', 'account')),
  status          text not null default 'pending' check (status in ('pending', 'erased')),
  requested_at    timestamptz not null default now(),
  attempts        integer not null default 0,
  last_attempt_at timestamptz,
  last_error_code text,
  escalated_at    timestamptz
);

create or replace function public.analytics_erasure_request_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'erased' then
    raise exception 'analytics erasure for % is still pending', old.user_id;
  end if;
  return old;
end;
$$;

drop trigger if exists analytics_erasure_request_guard on public.analytics_erasure_requests;
create trigger analytics_erasure_request_guard
  before delete on public.analytics_erasure_requests
  for each row execute function public.analytics_erasure_request_guard();

create table if not exists public.product_events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id   text not null check (actor_id ~ '^[0-9a-f]{32}$'),
  visit_id   uuid,
  event      text not null check (event ~ '^[a-z_]{1,40}$'),
  props      jsonb not null default '{}'::jsonb
               check (jsonb_typeof(props) = 'object' and pg_column_size(props) <= 512)
);

create index if not exists idx_pe_created_at on public.product_events (created_at);
create index if not exists idx_pe_actor_created on public.product_events (actor_id, created_at);
create index if not exists idx_pe_event_created on public.product_events (event, created_at);

-- Fingerprints only, never a secret. name is 'id' or 'audit'.
create table if not exists public.analytics_key_check (
  name        text primary key check (name in ('id', 'audit')),
  fingerprint text not null,
  state       text not null default 'ok' check (state in ('ok', 'unavailable', 'lost')),
  epoch       integer not null default 1,
  last_ok_at  timestamptz,
  updated_at  timestamptz not null default now()
);

create table if not exists public.analytics_purge_log (
  id               bigint generated always as identity primary key,
  run_at           timestamptz not null default now(),
  table_name       text not null,
  rows_deleted     bigint,
  oldest_remaining timestamptz,
  status           text not null check (status in ('ok', 'failed'))
);

create index if not exists idx_apl_run on public.analytics_purge_log (table_name, run_at);

-- admin_ref uses its own secret, so it can't be joined with actor_id.
create table if not exists public.analytics_access_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  admin_ref  text not null,
  key_epoch  integer not null,
  action     text not null,
  params     jsonb not null default '{}'::jsonb
);

create index if not exists idx_aal_created on public.analytics_access_log (created_at);

alter table public.analytics_events add column if not exists actor_id text
  check (actor_id ~ '^[0-9a-f]{32}$');
create index if not exists idx_ae_actor_created on public.analytics_events (actor_id, created_at);

alter table public.analytics_events drop constraint if exists analytics_events_event_type_check;
alter table public.analytics_events add constraint analytics_events_event_type_check
  check (event_type in (
    'research_completed', 'research_failed', 'cache_hit',
    'followup_completed', 'followup_failed', 'request_blocked'));

alter table public.analytics_events drop constraint if exists analytics_events_failure_stage_check;
alter table public.analytics_events add constraint analytics_events_failure_stage_check
  check (failure_stage in (
    'decomposition', 'search', 'search_no_results', 'synthesis',
    'moderation_output', 'history', 'pipeline', 'client_disconnect', 'internal',
    'rate_limit', 'spend_limit', 'moderation'));

alter table public.analytics_consent enable row level security;
alter table public.analytics_erasure_requests enable row level security;
alter table public.product_events enable row level security;
alter table public.analytics_key_check enable row level security;
alter table public.analytics_purge_log enable row level security;
alter table public.analytics_access_log enable row level security;

-- No policies on purpose; the service role bypasses RLS.
revoke all on public.analytics_consent from public, anon, authenticated;
revoke all on public.analytics_erasure_requests from public, anon, authenticated;
revoke all on public.product_events from public, anon, authenticated;
revoke all on public.analytics_key_check from public, anon, authenticated;
revoke all on public.analytics_purge_log from public, anon, authenticated;
revoke all on public.analytics_access_log from public, anon, authenticated;

grant all on public.analytics_consent to service_role;
grant all on public.analytics_erasure_requests to service_role;
grant all on public.product_events to service_role;
grant all on public.analytics_key_check to service_role;
grant all on public.analytics_purge_log to service_role;
grant all on public.analytics_access_log to service_role;

-- FOR SHARE here pairs with declare_analytics_key_lost, which has to wait for
-- linked writes in progress before it deletes. The fingerprint is the control:
-- state is shared, so one backend with a bad secret can't stop the right one.
create or replace function public.analytics_key_usable(p_fingerprint text)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  perform 1 from analytics_key_check
    where name = 'id' and state <> 'lost' and fingerprint = p_fingerprint
    for share;
  return found;
end;
$$;

-- With no committed row FOR SHARE has nothing to lock, so a grant still in flight
-- counts as no. The safe result of every race is a lost event.
create or replace function public.analytics_consent_granted(p_user uuid)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_granted boolean;
begin
  select c.granted into v_granted from analytics_consent c
    where c.user_id = p_user for share;
  return coalesce(v_granted, false);
end;
$$;

create or replace function public.record_product_events(
  p_user uuid, p_actor text, p_fingerprint text, p_events jsonb
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_written integer;
begin
  if p_user is null or p_actor is null
     or not analytics_consent_granted(p_user)
     or not analytics_key_usable(p_fingerprint) then
    return 0;
  end if;

  insert into product_events (actor_id, visit_id, event, props)
    select p_actor, nullif(e->>'visit_id', '')::uuid, e->>'event', coalesce(e->'props', '{}'::jsonb)
    from jsonb_array_elements(p_events) e;
  get diagnostics v_written = row_count;
  return v_written;
end;
$$;

-- Essential telemetry: always stored, and linked only with consent.
create or replace function public.record_analytics_event(
  p_user uuid, p_actor text, p_fingerprint text, p_row jsonb
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_actor text := null;
begin
  if p_user is not null and p_actor is not null
     and analytics_consent_granted(p_user)
     and analytics_key_usable(p_fingerprint) then
    v_actor := p_actor;
  end if;

  insert into analytics_events (
    actor_id, event_type, request_type, success, failure_stage, cache_hit,
    total_latency_ms, ttft_ms, decomposition_latency_ms, search_latency_ms, synthesis_latency_ms,
    subquery_count, successful_search_count, total_search_count, selected_source_count,
    estimated_cost_usd, metadata
  )
  select
    v_actor, r.event_type, r.request_type, r.success, r.failure_stage, coalesce(r.cache_hit, false),
    r.total_latency_ms, r.ttft_ms, r.decomposition_latency_ms, r.search_latency_ms, r.synthesis_latency_ms,
    r.subquery_count, r.successful_search_count, r.total_search_count, r.selected_source_count,
    r.estimated_cost_usd, coalesce(r.metadata, '{}'::jsonb)
  from jsonb_populate_record(null::analytics_events, p_row) r;
end;
$$;

-- Withdrawal step 1. It commits alone, so a failed erase can't undo it.
create or replace function public.set_analytics_consent(
  p_user uuid, p_granted boolean, p_wording_version text, p_source text
)
returns table (status text, erasure_required boolean)
language plpgsql
set search_path = public
as $$
declare
  v_previous boolean;
  v_open boolean;
begin
  select c.granted into v_previous from analytics_consent c
    where c.user_id = p_user for update;
  v_open := exists (select 1 from analytics_erasure_requests r where r.user_id = p_user);

  if p_granted and v_open then
    return query select 'erasure_pending'::text, true;
    return;
  end if;

  insert into analytics_consent (user_id, granted, decided_at, wording_version, source)
    values (p_user, p_granted, now(), p_wording_version, p_source)
    on conflict (user_id) do update
      set granted = excluded.granted,
          decided_at = excluded.decided_at,
          wording_version = excluded.wording_version,
          source = excluded.source,
          erasure_completed_at = null;

  if not p_granted and coalesce(v_previous, false) then
    insert into analytics_erasure_requests (user_id, kind) values (p_user, 'withdrawal')
      on conflict (user_id) do nothing;
    v_open := true;
  end if;

  return query select 'ok'::text, (not p_granted and v_open);
end;
$$;

-- Withdrawal step 2, and the erase for account deletion. Retried until it succeeds.
create or replace function public.erase_linked_analytics(
  p_user uuid, p_actor text, p_fingerprint text
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_kind text;
  v_status text;
begin
  if not analytics_key_usable(p_fingerprint) then
    raise exception 'analytics key is not usable; a wrong key would erase nothing';
  end if;

  select r.kind, r.status into v_kind, v_status from analytics_erasure_requests r
    where r.user_id = p_user for update;
  if not found or v_status <> 'pending' then
    return false;
  end if;

  delete from product_events where actor_id = p_actor;
  delete from analytics_events where actor_id = p_actor;

  update analytics_erasure_requests set status = 'erased' where user_id = p_user;
  if v_kind = 'withdrawal' then
    update analytics_consent set erasure_completed_at = now() where user_id = p_user;
    delete from analytics_erasure_requests where user_id = p_user;
  end if;
  return true;
end;
$$;

create or replace function public.mark_erasure_attempt(p_user uuid, p_error_code text)
returns void
language sql
set search_path = public
as $$
  update analytics_erasure_requests
    set attempts = attempts + 1, last_attempt_at = now(), last_error_code = p_error_code
    where user_id = p_user and status = 'pending';
$$;

-- Marks the request only: escalation never changes data.
create or replace function public.mark_erasure_escalated(p_user uuid)
returns void
language sql
set search_path = public
as $$
  update analytics_erasure_requests set escalated_at = now() where user_id = p_user;
$$;

create or replace function public.ack_analytics_erasure_notice(p_user uuid)
returns void
language sql
set search_path = public
as $$
  update analytics_consent set erasure_completed_at = null where user_id = p_user;
$$;

-- Returns true if linked rows may exist. Without a past grant or a pending erase
-- there's nothing to find, so deletion doesn't depend on the secret.
create or replace function public.request_account_erasure(p_user uuid)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_granted boolean;
  v_pending boolean;
  v_needed boolean;
begin
  select c.granted into v_granted from analytics_consent c
    where c.user_id = p_user for update;
  v_pending := exists (
    select 1 from analytics_erasure_requests r where r.user_id = p_user and r.status = 'pending'
  );
  v_needed := coalesce(v_granted, false) or v_pending;

  update analytics_consent set granted = false, decided_at = now() where user_id = p_user;

  insert into analytics_erasure_requests (user_id, kind, status)
    values (p_user, 'account', case when v_needed then 'pending' else 'erased' end)
    on conflict (user_id) do update set kind = 'account';
  return v_needed;
end;
$$;

-- Needs no secret, so chats go first even if the analytics erase has to wait.
create or replace function public.delete_account_content(p_user uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  delete from answer_feedback where user_id = p_user;
  delete from research_sessions where user_id = p_user;
end;
$$;

create or replace function public.install_analytics_key(
  p_name text, p_fingerprint text, p_mode text, p_old_fingerprint text
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_row analytics_key_check%rowtype;
begin
  select * into v_row from analytics_key_check where name = p_name for update;

  if p_mode = 'init' then
    if found then
      raise exception 'analytics key % is already installed', p_name;
    end if;
    insert into analytics_key_check (name, fingerprint, last_ok_at) values (p_name, p_fingerprint, now());
    return;
  end if;

  if not found then
    raise exception 'analytics key % is not installed', p_name;
  end if;

  if p_mode = 'rotate' then
    -- The id key moves through rekey_analytics_actors, or its rows would be orphaned.
    if p_name = 'id' then
      raise exception 'use rekey_analytics_actors to rotate the id key';
    end if;
    if v_row.fingerprint is distinct from p_old_fingerprint then
      raise exception 'rotation needs the current key';
    end if;
  elsif p_mode = 'after_loss' then
    if v_row.state <> 'lost' and p_name = 'id' then
      raise exception 'the key has not been declared lost';
    end if;
  else
    raise exception 'unknown mode %', p_mode;
  end if;

  update analytics_key_check
    set fingerprint = p_fingerprint, state = 'ok', epoch = epoch + 1,
        last_ok_at = now(), updated_at = now()
    where name = p_name;
end;
$$;

-- Reports the backend's key against the stored fingerprint. Never clears 'lost'.
create or replace function public.analytics_key_heartbeat(p_name text, p_fingerprint text)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_row analytics_key_check%rowtype;
begin
  select * into v_row from analytics_key_check where name = p_name for update;
  if not found then
    return 'missing';
  end if;
  if v_row.state = 'lost' then
    return 'lost';
  end if;

  if v_row.fingerprint = p_fingerprint then
    update analytics_key_check set state = 'ok', last_ok_at = now(), updated_at = now()
      where name = p_name;
    return 'ok';
  end if;

  update analytics_key_check set state = 'unavailable', updated_at = now() where name = p_name;
  return 'unavailable';
end;
$$;

create or replace function public.rekey_analytics_actors(
  p_pairs jsonb, p_old_fingerprint text, p_new_fingerprint text
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_fingerprint text;
begin
  select fingerprint into v_fingerprint from analytics_key_check
    where name = 'id' and state <> 'lost' for update;
  if v_fingerprint is distinct from p_old_fingerprint then
    raise exception 're-keying needs the current key';
  end if;

  create temporary table rekey_pairs on commit drop as
    select e->>'old' as old_actor, e->>'new' as new_actor from jsonb_array_elements(p_pairs) e;

  -- A row left under the old key could never be found again.
  if exists (
    select 1 from (
      select actor_id from product_events
      union
      select actor_id from analytics_events where actor_id is not null
    ) linked
    where linked.actor_id not in (select old_actor from rekey_pairs)
  ) then
    raise exception 'pairs do not cover every linked actor';
  end if;

  update product_events p set actor_id = m.new_actor
    from rekey_pairs m where p.actor_id = m.old_actor;
  update analytics_events a set actor_id = m.new_actor
    from rekey_pairs m where a.actor_id = m.old_actor;

  update analytics_key_check
    set fingerprint = p_new_fingerprint, state = 'ok', epoch = epoch + 1,
        last_ok_at = now(), updated_at = now()
    where name = 'id';
end;
$$;

-- Only people who have consented get a code on their old rows.
create or replace function public.backfill_analytics_actors(p_pairs jsonb, p_fingerprint text)
returns bigint
language plpgsql
set search_path = public
as $$
declare
  v_updated bigint;
begin
  if not analytics_key_usable(p_fingerprint) then
    raise exception 'analytics key is not usable';
  end if;

  update analytics_events a set actor_id = m.actor_id
    from (
      select (e->>'user_id')::uuid as user_id, e->>'actor_id' as actor_id
      from jsonb_array_elements(p_pairs) e
    ) m
    join analytics_consent c on c.user_id = m.user_id and c.granted
    where a.user_id = m.user_id and a.actor_id is null;
  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

-- Permanent loss of the id secret only. Individual erasure is then impossible, so
-- every linked row goes. Run by hand through the runbook; nothing schedules this.
create or replace function public.declare_analytics_key_lost(p_confirm text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_product bigint;
  v_essential bigint;
  v_requests bigint;
begin
  if p_confirm is distinct from 'I-HAVE-LOST-THE-ANALYTICS-ID-SECRET' then
    raise exception 'confirmation text does not match';
  end if;

  update analytics_key_check set state = 'lost', updated_at = now() where name = 'id';

  delete from product_events;
  get diagnostics v_product = row_count;
  delete from analytics_events where actor_id is not null;
  get diagnostics v_essential = row_count;

  update analytics_consent c set erasure_completed_at = now()
    from analytics_erasure_requests r
    where r.user_id = c.user_id and r.kind = 'withdrawal' and r.status = 'pending';
  update analytics_erasure_requests set status = 'erased' where status = 'pending';
  get diagnostics v_requests = row_count;
  delete from analytics_erasure_requests where kind = 'withdrawal';

  return jsonb_build_object(
    'product_events', v_product, 'analytics_events', v_essential, 'requests', v_requests
  );
end;
$$;

-- Runs nightly. It holds no secret, so it can't retry erasures, and it must never
-- run a global erase: a long fault is an escalation, not a reason to delete data.
create or replace function public.purge_analytics()
returns void
language plpgsql
set search_path = public
as $$
declare
  v_target record;
  v_deleted bigint;
  v_oldest timestamptz;
begin
  for v_target in
    select * from (values
      ('product_events', 'created_at', (now() - interval '90 days')::text),
      ('analytics_events', 'created_at', (now() - interval '90 days')::text),
      ('usage_daily', 'day', ((now() at time zone 'utc')::date - 90)::text)
    ) as t (table_name, column_name, cutoff)
  loop
    begin
      execute format('delete from %I where %I < %L', v_target.table_name, v_target.column_name, v_target.cutoff);
      get diagnostics v_deleted = row_count;
      execute format('select min(%I)::timestamptz from %I', v_target.column_name, v_target.table_name)
        into v_oldest;
      insert into analytics_purge_log (table_name, rows_deleted, oldest_remaining, status)
        values (v_target.table_name, v_deleted, v_oldest, 'ok');
    exception when others then
      insert into analytics_purge_log (table_name, status) values (v_target.table_name, 'failed');
    end;
  end loop;

  delete from analytics_purge_log where run_at < now() - interval '1 year';
  delete from analytics_access_log where created_at < now() - interval '1 year';
end;
$$;

create or replace function public.analytics_health()
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_last_purge timestamptz;
  v_failed boolean;
  v_oldest jsonb;
begin
  select min(last_ok) into v_last_purge from (
    select max(run_at) filter (where status = 'ok') as last_ok
    from analytics_purge_log
    where table_name in ('product_events', 'analytics_events', 'usage_daily')
    group by table_name
  ) t;

  select coalesce(bool_or(status = 'failed'), false) into v_failed from (
    select distinct on (table_name) status from analytics_purge_log
    order by table_name, run_at desc, id desc
  ) latest;

  select jsonb_build_object(
    'product_events', (select extract(epoch from now() - min(created_at)) from product_events),
    'analytics_events', (select extract(epoch from now() - min(created_at)) from analytics_events),
    'usage_daily', (select extract(epoch from now() - min(day)::timestamptz) from usage_daily)
  ) into v_oldest;

  return jsonb_build_object(
    'last_purge_at', v_last_purge,
    'last_purge_failed', v_failed,
    'oldest_row_seconds', v_oldest,
    -- Includes erased account requests: those accounts stay disabled until deleted.
    'pending_erasures', (select count(*) from analytics_erasure_requests),
    'oldest_pending_seconds', (
      select extract(epoch from now() - min(requested_at)) from analytics_erasure_requests
    ),
    'key_states', coalesce(
      (select jsonb_object_agg(name, state) from analytics_key_check), '{}'::jsonb
    ),
    'key_last_ok_at', coalesce(
      (select jsonb_object_agg(name, last_ok_at) from analytics_key_check), '{}'::jsonb
    )
  );
end;
$$;

-- Functions default to executable by everyone, and Supabase grants anon too.
do $$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in (
        'analytics_erasure_request_guard', 'analytics_key_usable', 'analytics_consent_granted',
        'record_product_events', 'record_analytics_event', 'set_analytics_consent',
        'erase_linked_analytics', 'mark_erasure_attempt', 'mark_erasure_escalated',
        'ack_analytics_erasure_notice', 'request_account_erasure', 'delete_account_content',
        'install_analytics_key', 'analytics_key_heartbeat', 'rekey_analytics_actors',
        'backfill_analytics_actors', 'declare_analytics_key_lost', 'purge_analytics',
        'analytics_health'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_function);
    execute format('grant execute on function %s to service_role', v_function);
  end loop;
end;
$$;

-- Needs the pg_cron extension. Without it the health check fails, which is the signal.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-analytics', '17 3 * * *', 'select public.purge_analytics()');
  else
    raise warning 'pg_cron is not available: purge_analytics() will not run on a schedule';
  end if;
end;
$$;

commit;

-- The anon key must get "permission denied" from every new table and function.
