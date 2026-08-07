-- Mid-session exercise editing (US-2.18, AC-2.23).
--
-- The machine you planned for is occupied, so you do something else. §6 calls this
-- FIRST-CLASS, not an edge case — the plan is a suggestion, and a log that cannot
-- record what actually happened is a log you stop trusting.
--
-- These are RPCs rather than three PostgREST calls because `position` is a
-- contiguous ordering the UI aligns blocks and sets by. A delete that renumbered in
-- a second round trip could be interrupted between the two, and every set below the
-- gap would render against the wrong exercise.
--
-- Both write to the SESSION's own plan (`workout_plans` where `not is_template`),
-- which `start_session` copied. Editing today can never reach Day 1 Push.

create or replace function session_add_exercise(
  p_session   uuid,
  p_exercise  uuid,
  p_sets      int default 3,
  p_rep_low   int default null,
  p_rep_high  int default null
)
returns int
language plpgsql
as $$
declare
  v_plan uuid;
  v_next int;
begin
  select plan_id into v_plan from workout_sessions where id = p_session;
  if v_plan is null then
    raise exception 'session % has no plan', p_session;
  end if;

  select coalesce(max("position"), 0) + 1 into v_next
  from plan_exercises where plan_id = v_plan;

  -- Appended at the end. Inserting mid-list is the reorder control's job, not this
  -- one's — you are adding what you are about to do next.
  insert into plan_exercises (plan_id, "position", exercise_id, target_sets, target_rep_low, target_rep_high)
  values (v_plan, v_next, p_exercise, p_sets, p_rep_low, p_rep_high);

  return v_next;
end;
$$;

create or replace function session_remove_exercise(p_session uuid, p_position int)
returns void
language plpgsql
as $$
declare
  v_plan uuid;
begin
  select plan_id into v_plan from workout_sessions where id = p_session;
  if v_plan is null then
    raise exception 'session % has no plan', p_session;
  end if;

  -- The committed sets go too (AC-2.23). Removing the exercise but keeping its sets
  -- would leave volume in every total with nothing on screen to explain it — which
  -- is the spreadsheet's 9,352 orphaned kilograms, reinvented.
  delete from workout_sets
  where session_id = p_session and "position" = p_position;

  delete from plan_exercises
  where plan_id = v_plan and "position" = p_position;

  -- Close the gap, in both tables, so `position` stays contiguous.
  update plan_exercises
  set "position" = "position" - 1
  where plan_id = v_plan and "position" > p_position;

  update workout_sets
  set "position" = "position" - 1
  where session_id = p_session and "position" > p_position;
end;
$$;
