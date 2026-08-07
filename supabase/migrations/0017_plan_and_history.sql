-- The day plan: the seeded 4-day template, per-gym history, and starting a session.

-- ---------------------------------------------------------------------------
-- 1. Two exercises the 4-Day Workout Plan references but the library lacks
-- ---------------------------------------------------------------------------
-- The plan is the spreadsheet's most usable artefact, and it names movements the
-- imported library never contained. `Calf Raise` has no counterpart at all — there
-- were zero `calves` exercises. `Plank` matters more than it looks: `duration` load
-- type is what keeps it logged in seconds and out of every volume total (US-2.9,
-- AC-2.3). Adding it as `external_weight` would have invented 1,800 fake kg.
insert into exercises (name, name_norm, muscle_group, movement_pattern, load_type, equipment)
select 'Calf Raise', exercise_name_norm('Calf Raise'), 'calves', 'isolation', 'external_weight', 'Machine'
where not exists (select 1 from exercises where name_norm = exercise_name_norm('Calf Raise'));

insert into exercises (name, name_norm, muscle_group, movement_pattern, load_type, equipment)
select 'Plank', exercise_name_norm('Plank'), 'abs_core', 'core', 'duration', 'Bodyweight'
where not exists (select 1 from exercises where name_norm = exercise_name_norm('Plank'));

-- `Hamstring Curl` is what the plan calls the library's `Leg Curl`. An alias, not a
-- second exercise — the same fix the food library uses for a renamed row.
update exercises
   set aliases = array(select distinct a from unnest(aliases || array['Hamstring Curl']) a)
 where name_norm = exercise_name_norm('Leg Curl');

-- ---------------------------------------------------------------------------
-- 2. The 4-day template
-- ---------------------------------------------------------------------------
-- MIGRATION REPORT (AC-2.13) — every row whose name did not resolve exactly:
--
--   plan row                    → library exercise      why
--   ─────────────────────────────────────────────────────────────────────────
--   Hamstring Curl              → Leg Curl              same movement, aliased
--   Rear Delt / Face Pull       → Face Pulls            the library has both a
--                                                       machine rear-delt fly and
--                                                       face pulls; the plan's
--                                                       "strict form, 12–20" reads
--                                                       as face pulls
--   Lat Pulldown or Pull-Ups    → Lat Pulldown          an either/or is not an
--                                                       exercise; the alternative
--                                                       is kept in progression_rule
--   Biceps + Triceps            → DB Bicep Curl AND     "superset if time is
--                                  Rope Tricep Pushdown limited" is a session
--                                                       grouping, not a name (§4.1)
--   Calf Raise, Plank / Core    → newly added above     absent from the library
--
-- Day 4 therefore holds 6 rows rather than 5: splitting the superset is the whole
-- point of §4.1's rule.
do $$
declare
  d1 uuid; d2 uuid; d3 uuid; d4 uuid;
begin
  -- Idempotent: re-running the migration must not duplicate the template.
  if exists (select 1 from workout_plans where name = 'Day 1 Push' and is_template) then
    return;
  end if;

  insert into workout_plans (name, day_label, is_template)
  values ('Day 1 Push', 'Day 1', true) returning id into d1;
  insert into workout_plans (name, day_label, is_template)
  values ('Day 2 Pull', 'Day 2', true) returning id into d2;
  insert into workout_plans (name, day_label, is_template)
  values ('Day 3 Legs', 'Day 3', true) returning id into d3;
  insert into workout_plans (name, day_label, is_template)
  values ('Day 4 Upper Specialisation', 'Day 4', true) returning id into d4;

  insert into plan_exercises (plan_id, position, exercise_id, target_sets, target_rep_low, target_rep_high, progression_rule)
  select v.plan_id, v.position, e.id, v.sets, v.low, v.high, v.rule
  from (values
    -- Day 1 Push
    (d1, 1, 'Shoulder Press Machine', 3, 6, 10,  'Add reps first, then increase load'),
    (d1, 2, 'Incline DB Press',       3, 6, 12,  'Double progression'),
    (d1, 3, 'Chest Press Machine',    3, 8, 12,  'Add 1 rep per set before loading'),
    (d1, 4, 'Lateral Raises',         3, 10, 15, 'Clean reps before heavier load'),
    (d1, 5, 'Rope Tricep Pushdown',   3, 8, 15,  'Add reps, then one plate increment'),
    -- Day 2 Pull
    (d2, 1, 'Pull-Ups',               3, 5, 10,  'Add clean total reps'),
    (d2, 2, 'Lat Pulldown',           3, 8, 12,  'Double progression'),
    (d2, 3, 'DB One Arm Row',         3, 8, 12,  'Add reps equally per side'),
    (d2, 4, 'Face Pulls',             3, 12, 20, 'Prioritise control and rear-delt tension'),
    (d2, 5, 'DB Bicep Curl',          3, 8, 12,  'Add reps before load'),
    -- Day 3 Legs
    (d3, 1, 'Leg Press',              3, 8, 12,  'Add reps, then load'),
    (d3, 2, 'Leg Curl',               3, 10, 15, 'Controlled eccentric'),
    (d3, 3, 'Leg Extension',          3, 10, 15, 'Add reps before load'),
    (d3, 4, 'Calf Raise',             3, 10, 20, 'Pause in the stretched and shortened position'),
    (d3, 5, 'Plank',                  3, 30, 60, 'Add time gradually — seconds, never volume'),
    -- Day 4 Upper Specialisation
    (d4, 1, 'Lateral Raises',         3, 12, 20, 'Add clean reps'),
    (d4, 2, 'Lat Pulldown',           3, 6, 12,  'Beat prior session by one rep. Pull-Ups are an equal alternative'),
    (d4, 3, 'Incline DB Press',       3, 8, 12,  'Moderate load, full range'),
    (d4, 4, 'Face Pulls',             3, 12, 20, 'Strict form'),
    (d4, 5, 'DB Bicep Curl',          3, 8, 15,  'Superset with the tricep pushdown if time is limited'),
    (d4, 6, 'Rope Tricep Pushdown',   3, 8, 15,  'Superset with the bicep curl if time is limited')
  ) as v(plan_id, position, name, sets, low, high, rule)
  join exercises e on e.name_norm = exercise_name_norm(v.name);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Per-gym history: LAST and BEST
-- ---------------------------------------------------------------------------
-- Gym-scoped, because a 45 kg cable stack at one gym is not 45 kg at another
-- (§3.2). Cross-gym numbers are not hidden, they are simply not called a best.
--
-- LAST is the heaviest *working* set of the most recent session, not the last row
-- entered: a drop set logged last would otherwise read as a regression.
create or replace function exercise_history(p_gym uuid)
returns table (
  exercise_id       uuid,
  last_performed_on date,
  last_weight_kg    numeric,
  last_reps         int,
  last_duration_sec int,
  best_weight_kg    numeric,
  best_reps         int,
  best_on           date,
  sessions_since    int
)
language sql
stable
as $$
  with sets as (
    select s.exercise_id, s.weight_kg, s.reps, s.duration_sec, w.performed_on
    from workout_sets s
    join workout_sessions w on w.id = s.session_id
    where w.gym_id = p_gym and s.kind = 'working'
  ),
  latest as (
    select distinct on (exercise_id) exercise_id, performed_on, weight_kg, reps, duration_sec
    from sets
    order by exercise_id, performed_on desc,
             weight_kg desc nulls last, reps desc nulls last, duration_sec desc nulls last
  ),
  best as (
    select distinct on (exercise_id) exercise_id, weight_kg, reps, performed_on
    from sets
    order by exercise_id,
             weight_kg desc nulls last, reps desc nulls last, duration_sec desc nulls last,
             performed_on asc
  ),
  since as (
    select l.exercise_id,
           (select count(distinct w2.performed_on)
              from workout_sessions w2
             where w2.gym_id = p_gym and w2.performed_on > l.performed_on)::int as n
    from latest l
  )
  select l.exercise_id, l.performed_on, l.weight_kg, l.reps, l.duration_sec,
         b.weight_kg, b.reps, b.performed_on, since.n
  from latest l
  left join best b on b.exercise_id = l.exercise_id
  left join since on since.exercise_id = l.exercise_id;
$$;

-- ---------------------------------------------------------------------------
-- 4. Plan → session
-- ---------------------------------------------------------------------------
-- One transaction: a plan whose session failed to open, or a session pointing at a
-- half-written plan, are both worse than nothing.
--
-- The plan is copied rather than referenced. Editing today's plan must not rewrite
-- the template you started from, and next month's identical session must not be
-- retconned by a template edit — the same reasoning as a frozen food log entry.
create or replace function create_session_from_plan(
  p_session_id uuid,
  p_name       text,
  p_performed_on date,
  p_gym_id     uuid,
  p_exercise_ids uuid[],
  p_target_sets  int[],
  p_rep_low      int[],
  p_rep_high     int[]
) returns workout_sessions
language plpgsql
as $$
declare
  plan_id uuid;
  session workout_sessions;
begin
  if array_length(p_exercise_ids, 1) is null then
    raise exception 'a session needs at least one exercise';
  end if;

  insert into workout_plans (name, day_label, is_template)
  values (p_name, null, false)
  returning id into plan_id;

  insert into plan_exercises (plan_id, position, exercise_id, target_sets, target_rep_low, target_rep_high)
  select plan_id, ordinality::int, p_exercise_ids[ordinality],
         p_target_sets[ordinality], p_rep_low[ordinality], p_rep_high[ordinality]
  from generate_subscripts(p_exercise_ids, 1) as ordinality;

  -- Client-generated id, so a replayed offline flush upserts instead of opening a
  -- second session (PRD-001 §4.2).
  insert into workout_sessions (id, performed_on, name, plan_id, gym_id)
  values (p_session_id, p_performed_on, p_name, plan_id, p_gym_id)
  on conflict (id) do update set plan_id = excluded.plan_id, gym_id = excluded.gym_id
  returning * into session;

  return session;
end $$;
