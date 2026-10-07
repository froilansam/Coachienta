-- A personal record is judged PER SET POSITION, over the whole record.
--
-- ## What was wrong
--
-- `prior_sets` handed every prior working set of an exercise back as one pool, so a
-- set was measured against the best set ever done — whichever position it came from.
-- One consequence, and it is the whole of progressive overload:
--
--   set 1  80 kg × 8   ← the only set that can ever be a record
--   set 2  70 kg × 8
--   set 3  60 kg × 8   ← going 60 → 65 here is progress that nothing recorded
--
-- Sets 2 and 3 are compared against set 1's number and lose forever. The back-off
-- sets going up is real overload and it was invisible.
--
-- ## The rule now
--
-- Set 1 competes with every set 1 on record, set 2 with every set 2, and so on. Set
-- position is the **gate**; beating the all-time best as well is a rank on top of it
-- (`pr_scope`), never a way in. That ordering matters — 50 kg × 11 is not progress at
-- a position that has already held 60 kg × 20, however it compares to the rest.
--
-- Still gym-scoped (§3.2): a 45 kg cable stack at one gym is not 45 kg at another.
-- "Whole record" means every session, not every gym.

-- ---------------------------------------------------------------------------
-- 1. The rank a record earned
-- ---------------------------------------------------------------------------
-- Null on every row written before this migration. Those were judged against the
-- undivided pool, which IS the all-time comparison — so readers coalesce null to
-- `all_time` rather than inventing a third state for history.
alter table workout_sets add column if not exists pr_scope text;

do $$
begin
  alter table workout_sets add constraint workout_sets_pr_scope_check
    check (pr_scope is null or pr_scope in ('all_time', 'set'));
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Prior sets, carrying the position each one held
-- ---------------------------------------------------------------------------
-- `set_ordinal` is the rank among that session's WORKING sets, not `set_index`.
--
-- The two differ, and the difference is a correctness bug rather than a detail:
-- warmups occupy a `set_index` (the `unique (session_id, position, set_index, side)`
-- constraint requires it), so a day with one warmup puts the first working set at
-- index 2 while a day without one puts it at index 1. Comparing those as "set 1 vs
-- set 2" would grade a working set against a different working set every time the
-- warmup count changed. The WHERE clause runs before the window function, so the
-- numbering here already counts only the sets that qualify.
--
-- Partitioned by `side` as well, because unilateral work numbers left and right
-- independently — matching `blankSet` in `lib/domain/train/session.ts`.
--
-- Dropped by iterating pg_catalog rather than by naming a signature: `0024` guessed a
-- signature, the drop silently did nothing, and PostgREST then refused every call with
-- PGRST203. A return-type change cannot use `create or replace` at all.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('prior_sets', 'pr_timeline', 'session_sets')
  loop
    execute format('drop function %s', fn.sig);
  end loop;
end $$;

create function prior_sets(p_gym uuid, p_before_session uuid default null)
returns table (
  exercise_id  uuid,
  performed_on date,
  set_ordinal  int,
  side         text,
  weight_kg    numeric,
  reps         int,
  duration_sec int
)
language sql
stable
as $$
  select s.exercise_id,
         w.performed_on,
         row_number() over (
           partition by s.session_id, s.exercise_id, coalesce(s.side, '')
           order by s.set_index
         )::int,
         s.side,
         s.weight_kg, s.reps, s.duration_sec
  from workout_sets s
  join workout_sessions w on w.id = s.session_id
  where w.gym_id = p_gym
    and s.kind in ('working', 'top')
    -- The session being logged is excluded. Position scoping mostly makes this moot
    -- — today's set 2 is not in set 3's pool — but a re-saved set would otherwise
    -- find its own previous value sitting at its own position.
    and (p_before_session is null or s.session_id <> p_before_session)
  order by s.exercise_id, w.performed_on;
$$;

-- ---------------------------------------------------------------------------
-- 3. Reading a session back, with the rank each record earned
-- ---------------------------------------------------------------------------
-- `pr_scope` travels with the set so reopening a session shows the stamp it earned.
-- The verdict's prose (`basis`) is deliberately not stored: it is derived from
-- evidence that is all still queryable, and a stored sentence is a sentence that goes
-- stale the way the spreadsheet's targets did.
create function session_sets(p_session_id uuid)
returns table (
  id           uuid,
  exercise_id  uuid,
  -- Quoted: `position` is a reserved word (the `position(x in y)` function), and a
  -- bare one in a RETURNS TABLE list is a syntax error.
  "position"   int,
  set_index    int,
  kind         set_kind,
  weight_kg    numeric,
  reps         int,
  duration_sec int,
  side         text,
  rpe          numeric,
  is_failure   boolean,
  is_pr        boolean,
  pr_kinds     text[],
  pr_scope     text,
  notes        text,
  volume_kg    numeric
)
language sql
stable
as $$
  select s.id, s.exercise_id, s.position, s.set_index, s.kind,
         s.weight_kg, s.reps, s.duration_sec, s.side, s.rpe,
         s.is_failure, s.is_pr, s.pr_kinds, s.pr_scope, s.notes, s.volume_kg
  from workout_sets s
  where s.session_id = p_session_id
  order by s.position, s.set_index, s.side nulls first;
$$;

-- ---------------------------------------------------------------------------
-- 4. PR timeline, per position
-- ---------------------------------------------------------------------------
-- The timeline now carries far more dots — four positions can each hold a record —
-- so it has to say which position and which rank, or it becomes the spreadsheet's
-- `PR Flag` column again: a mark on everything, meaning nothing.
create function pr_timeline(p_gym uuid, p_days int default 180)
returns table (
  performed_on  date,
  exercise_name text,
  muscle_group  muscle_group,
  pr_kinds      text[],
  pr_scope      text,
  set_ordinal   int,
  weight_kg     numeric,
  reps          int
)
language sql
stable
as $$
  with ranked as (
    select s.exercise_id, s.is_pr, s.pr_kinds, s.pr_scope, s.weight_kg, s.reps,
           w.performed_on,
           row_number() over (
             partition by s.session_id, s.exercise_id, coalesce(s.side, '')
             order by s.set_index
           )::int as set_ordinal
    from workout_sets s
    join workout_sessions w on w.id = s.session_id
    where w.gym_id = p_gym
      and s.kind in ('working', 'top')
  )
  select r.performed_on, e.name, e.muscle_group, r.pr_kinds,
         coalesce(r.pr_scope, 'all_time'), r.set_ordinal, r.weight_kg, r.reps
  from ranked r
  join exercises e on e.id = r.exercise_id
  where r.is_pr
    and r.performed_on >= current_date - p_days
  order by r.performed_on desc, e.name, r.set_ordinal;
$$;

-- PostgREST caches the schema, so a changed signature is invisible to the app until
-- it reloads — the other half of why `0024` failed in the app while the same SQL
-- worked from a direct session.
notify pgrst, 'reload schema';
