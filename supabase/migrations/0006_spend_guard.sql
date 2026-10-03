-- 0006_spend_guard.sql
--
-- Daily spend ledger for backend/utils/spend_guard.py. Amounts are estimated
-- micro-USD per UTC day. Service role only.
--
-- Idempotent. Apply before deploying the backend, which fails closed without it.

begin;

create table if not exists public.usage_daily (
  user_id        uuid    not null references auth.users(id) on delete cascade,
  day            date    not null,
  spend_micros   bigint  not null default 0 check (spend_micros >= 0),
  research_count integer not null default 0,
  followup_count integer not null default 0,
  audio_chars    integer not null default 0,
  primary key (user_id, day)
);

-- Aggregate only; survives account deletion.
create table if not exists public.spend_daily (
  day          date   primary key,
  spend_micros bigint not null default 0 check (spend_micros >= 0)
);

alter table public.usage_daily enable row level security;
alter table public.spend_daily enable row level security;

revoke all on public.usage_daily from anon, authenticated;
revoke all on public.spend_daily from anon, authenticated;

-- User limit is checked first for the more specific error. Always lock
-- spend_daily before usage_daily to avoid deadlocks.

create or replace function public.reserve_spend(
  p_user         uuid,
  p_kind         text,
  p_cost         bigint,
  p_user_limit   bigint,
  p_global_limit bigint,
  p_units        integer default 1
)
returns table (allowed boolean, reason text, user_spent bigint, global_spent bigint)
language plpgsql
set search_path = public
as $$
declare
  v_day    date := (now() at time zone 'utc')::date;
  v_global bigint;
  v_user   bigint;
begin
  if p_cost is null or p_cost <= 0 then
    raise exception 'reserve_spend: p_cost must be positive, got %', p_cost;
  end if;
  if p_kind not in ('research', 'followup', 'audio') then
    raise exception 'reserve_spend: unknown kind %', p_kind;
  end if;

  insert into spend_daily (day) values (v_day) on conflict (day) do nothing;
  select s.spend_micros into v_global
    from spend_daily s where s.day = v_day for update;

  insert into usage_daily (user_id, day) values (p_user, v_day)
    on conflict (user_id, day) do nothing;
  select u.spend_micros into v_user
    from usage_daily u where u.user_id = p_user and u.day = v_day for update;

  if v_user + p_cost > p_user_limit then
    return query select false, 'user'::text, v_user, v_global;
    return;
  end if;
  if v_global + p_cost > p_global_limit then
    return query select false, 'global'::text, v_user, v_global;
    return;
  end if;

  update spend_daily set spend_micros = spend_micros + p_cost where day = v_day;
  update usage_daily
     set spend_micros   = spend_micros + p_cost,
         research_count = research_count + (case when p_kind = 'research' then 1 else 0 end),
         followup_count = followup_count + (case when p_kind = 'followup' then 1 else 0 end),
         audio_chars    = audio_chars + (case when p_kind = 'audio' then greatest(p_units, 0) else 0 end)
   where user_id = p_user and day = v_day;

  return query select true, null::text, v_user + p_cost, v_global + p_cost;
end;
$$;

-- Called on cache hits. A refund after UTC midnight is a no-op.

create or replace function public.refund_spend(
  p_user  uuid,
  p_kind  text,
  p_cost  bigint,
  p_units integer default 1
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
begin
  if p_cost is null or p_cost <= 0 then
    raise exception 'refund_spend: p_cost must be positive, got %', p_cost;
  end if;

  update spend_daily
     set spend_micros = greatest(spend_micros - p_cost, 0)
   where day = v_day;

  update usage_daily
     set spend_micros   = greatest(spend_micros - p_cost, 0),
         research_count = greatest(research_count - (case when p_kind = 'research' then 1 else 0 end), 0),
         followup_count = greatest(followup_count - (case when p_kind = 'followup' then 1 else 0 end), 0),
         audio_chars    = greatest(audio_chars - (case when p_kind = 'audio' then greatest(p_units, 0) else 0 end), 0)
   where user_id = p_user and day = v_day;
end;
$$;

revoke all on function public.reserve_spend(uuid, text, bigint, bigint, bigint, integer)
  from public, anon, authenticated;
revoke all on function public.refund_spend(uuid, text, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_spend(uuid, text, bigint, bigint, bigint, integer)
  to service_role;
grant execute on function public.refund_spend(uuid, text, bigint, integer)
  to service_role;

commit;

-- The anon key must get "permission denied" from POST /rest/v1/rpc/refund_spend.
