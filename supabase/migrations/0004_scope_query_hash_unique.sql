-- 0004_scope_query_hash_unique.sql
--
-- Makes query_hash uniqueness per-user instead of global.
--
-- THE BUG THIS FIXES
-- research_sessions carried a UNIQUE constraint on query_hash alone, so only
-- ONE account in the entire system could ever own a given query string. When a
-- second user searched a query someone else had already run, the background
-- insert raised
--     duplicate key value violates unique constraint "research_sessions_query_hash_key"
-- the save was abandoned, and that user's research silently never reached their
-- history. 0001 added the composite index idx_rs_user_query_hash for the
-- per-user cache lookup but left the global constraint in place, so tenant
-- isolation was incomplete by construction: two tenants collided on any shared
-- query.
--
-- NON-BREAKING. Safe to apply before or after 0003_enable_rls.sql, and safe to
-- re-run: the constraint drop is discovered by column set (not by name), the
-- index creation is IF NOT EXISTS, and the duplicate guard aborts rather than
-- leaving the table half-migrated.
--
-- NOTE ON REPEATS: with this index a single user still cannot hold two sessions
-- with the same query string. That is intentional here (query_hash is the cache
-- key, one row per user per query), and it is no longer silent — the API now
-- reports an unsaved answer instead of discarding it. If you would rather let a
-- user re-ask the same question and keep both answers, drop the word `unique`
-- from the CREATE INDEX at the bottom; nothing in the application requires
-- uniqueness, because check_cache already takes the most recent match.

begin;

-- ---------------------------------------------------------------------------
-- 1. Remove any single-column uniqueness on query_hash.
--
-- Matched by column set rather than by the expected name
-- (research_sessions_query_hash_key), so this still works if the constraint was
-- created under a different name, and no-ops cleanly if it is already gone.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  dropped int := 0;
begin
  -- 1a. Uniqueness expressed as a CONSTRAINT.
  for r in
    select con.conname
      from pg_constraint con
      join pg_class     rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and rel.relname = 'research_sessions'
       and con.contype in ('u', 'p')
       and array_length(con.conkey, 1) = 1
       and (
             select att.attname
               from pg_attribute att
              where att.attrelid = con.conrelid
                and att.attnum   = con.conkey[1]
           ) = 'query_hash'
  loop
    raise notice 'Dropping constraint % on research_sessions', r.conname;
    execute format('alter table public.research_sessions drop constraint %I', r.conname);
    dropped := dropped + 1;
  end loop;

  -- 1b. Uniqueness expressed as a bare INDEX (not backing a constraint).
  for r in
    select cls.relname
      from pg_index      idx
      join pg_class      cls on cls.oid = idx.indexrelid
      join pg_class      tbl on tbl.oid = idx.indrelid
      join pg_namespace  nsp on nsp.oid = tbl.relnamespace
     where nsp.nspname = 'public'
       and tbl.relname = 'research_sessions'
       and idx.indisunique
       and idx.indnkeyatts = 1
       and (
             select att.attname
               from pg_attribute att
              where att.attrelid = idx.indrelid
                and att.attnum   = idx.indkey[0]
           ) = 'query_hash'
       and not exists (
             select 1 from pg_constraint c where c.conindid = idx.indexrelid
           )
  loop
    raise notice 'Dropping unique index % on research_sessions', r.relname;
    execute format('drop index public.%I', r.relname);
    dropped := dropped + 1;
  end loop;

  if dropped = 0 then
    raise notice 'No single-column uniqueness on query_hash found (already migrated)';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Refuse to proceed if the data cannot satisfy the new index.
--
-- Cannot happen while step 1's constraint was in force, but it can if this
-- migration is re-run after the constraint was dropped by other means. Abort
-- loudly rather than let CREATE UNIQUE INDEX fail with a bare duplicate-key.
-- ---------------------------------------------------------------------------

do $$
declare
  dupes int;
begin
  select count(*) into dupes
    from (
      select user_id, query_hash
        from public.research_sessions
       where user_id is not null
       group by user_id, query_hash
      having count(*) > 1
    ) d;

  if dupes > 0 then
    raise exception
      'Cannot add unique (user_id, query_hash): % duplicated pair(s) exist. '
      'Inspect with: select user_id, query_hash, count(*) from public.research_sessions '
      'group by 1,2 having count(*) > 1;',
      dupes;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Per-user uniqueness.
--
-- NULL user_id rows are not constrained (NULLs are distinct in a unique index).
-- 0002_backfill_legacy_sessions.sql leaves none behind, so this is moot in
-- practice and deliberately not tightened further.
-- ---------------------------------------------------------------------------

create unique index if not exists uq_rs_user_query_hash
  on public.research_sessions (user_id, query_hash);

-- Redundant now: same columns, same order, and the unique index above serves
-- every lookup it served.
drop index if exists public.idx_rs_user_query_hash;

commit;

-- Verify:
--   -- expect exactly one row, uq_rs_user_query_hash
--   select indexname from pg_indexes
--    where tablename = 'research_sessions' and indexdef ilike '%unique%';
--
--   -- expect 0: no remaining single-column uniqueness on query_hash
--   select con.conname from pg_constraint con
--     join pg_class rel on rel.oid = con.conrelid
--    where rel.relname = 'research_sessions' and con.contype = 'u'
--      and array_length(con.conkey,1) = 1;
