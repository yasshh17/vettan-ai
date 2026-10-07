-- 0007_profiles.sql
--
-- date_of_birth for the 18+ signup check. Written by /auth/callback once
-- the session exists post-confirmation, from the value signUp() stashed
-- in auth metadata.
--
-- Non-breaking, idempotent.

begin;

create table if not exists public.profiles (
  user_id       uuid not null primary key references auth.users(id) on delete cascade,
  date_of_birth date not null,
  created_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;

-- Own row only, and no update policy — a wrong DOB gets fixed via the
-- service role, not by the user editing their own age gate.

create policy profiles_select on public.profiles
  for select using (user_id = auth.uid());

create policy profiles_insert on public.profiles
  for insert with check (user_id = auth.uid());

commit;

-- Verify (expect 0 rows, run with the anon key and no user JWT):
--   select count(*) from public.profiles;
