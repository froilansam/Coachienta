-- Editing goals: nutrition targets, training phase, coach rules.
--
-- Every one of these is a supersede, not an update. The old row keeps its date
-- range and stays queryable (AC-4.3), which is what makes a past day gradeable
-- against the targets that were active on THAT day (PRD-003 §5.1-0a). Overwriting
-- in place would silently re-score every historical day.
--
-- All three are RPCs because the `one_active_*` partial unique indexes forbid two
-- open rows for even an instant: the old row must close and the new one open in
-- the same transaction, or the insert fails.

-- ---------------------------------------------------------------------------
-- 1. Nutrition targets
-- ---------------------------------------------------------------------------
create or replace function supersede_nutrition_targets(
  p_effective_from date,
  p_phase_label    text,
  p_kcal_gym_low   int,
  p_kcal_gym_high  int,
  p_kcal_rest_low  int,
  p_kcal_rest_high int,
  p_protein_g      int,
  p_carbs_gym_low  int,
  p_carbs_gym_high int,
  p_carbs_rest_low int,
  p_carbs_rest_high int,
  p_fat_low        int,
  p_fat_high       int,
  p_kcal_floor     int,
  p_rationale      text default null
) returns nutrition_targets
language plpgsql
as $$
declare
  result nutrition_targets;
  prev   nutrition_targets;
begin
  select * into prev from nutrition_targets where effective_to is null;

  if prev.id is not null then
    if p_effective_from <= prev.effective_from then
      -- Otherwise the closed row would end before it began, and the check
      -- constraint `effective_to >= effective_from` would fire with a message
      -- that explains nothing.
      raise exception 'new targets must start after % (the current row began then)', prev.effective_from;
    end if;
    -- Closes the day before the new one opens: no gap, no overlap.
    update nutrition_targets
       set effective_to = p_effective_from - 1
     where id = prev.id;
  end if;

  insert into nutrition_targets (
    effective_from, effective_to, phase_label,
    kcal_gym_low, kcal_gym_high, kcal_rest_low, kcal_rest_high,
    protein_g, carbs_gym_low, carbs_gym_high, carbs_rest_low, carbs_rest_high,
    fat_low, fat_high, kcal_floor, rationale
  ) values (
    p_effective_from, null, p_phase_label,
    p_kcal_gym_low, p_kcal_gym_high, p_kcal_rest_low, p_kcal_rest_high,
    p_protein_g, p_carbs_gym_low, p_carbs_gym_high, p_carbs_rest_low, p_carbs_rest_high,
    p_fat_low, p_fat_high, p_kcal_floor, p_rationale
  )
  returning * into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Training phase
-- ---------------------------------------------------------------------------
create or replace function supersede_training_phase(
  p_effective_from date,
  p_label          text,
  p_goal_kind      text,
  p_target_weight_kg numeric,
  p_target_rate_kg_per_week numeric,
  p_bf_ceiling_pct numeric,
  p_notes          text default null
) returns training_phases
language plpgsql
as $$
declare
  result training_phases;
  prev   training_phases;
begin
  select * into prev from training_phases where effective_to is null;

  if prev.id is not null then
    if p_effective_from <= prev.effective_from then
      raise exception 'new phase must start after % (the current phase began then)', prev.effective_from;
    end if;
    update training_phases set effective_to = p_effective_from - 1 where id = prev.id;
  end if;

  insert into training_phases (
    label, goal_kind, effective_from, effective_to,
    target_weight_kg, target_rate_kg_per_week, bf_ceiling_pct, notes
  ) values (
    p_label, p_goal_kind, p_effective_from, null,
    p_target_weight_kg, p_target_rate_kg_per_week, p_bf_ceiling_pct, p_notes
  )
  returning * into result;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Coach rules
-- ---------------------------------------------------------------------------
-- Superseding a rule points the old one at the new one and deactivates it. The
-- old row STAYS — the registry's whole purpose is that a retired instruction is
-- visible in history rather than deleted, so you can see what the coach used to
-- be told (AC-4.9).
create or replace function supersede_coach_rule(
  p_old_id     uuid,
  p_category   rule_category,
  p_title      text,
  p_content    text,
  p_priority   int,
  p_is_critical boolean
) returns coach_rules
language plpgsql
as $$
declare
  result coach_rules;
begin
  if not exists (select 1 from coach_rules where id = p_old_id) then
    raise exception 'no rule with id %', p_old_id;
  end if;

  insert into coach_rules (category, title, content, priority, is_critical, source)
  values (p_category, p_title, p_content, p_priority, p_is_critical, 'superseded in app')
  returning * into result;

  update coach_rules
     set superseded_by = result.id,
         is_active     = false
   where id = p_old_id;

  return result;
end;
$$;

-- Retiring without a replacement: the instruction no longer applies, and there is
-- nothing to point at. Still not a delete.
create or replace function retire_coach_rule(p_id uuid)
returns void
language sql
as $$
  update coach_rules set is_active = false where id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- 4. Volume share by priority muscle group (self-consistency check 8)
-- ---------------------------------------------------------------------------
-- Compares the stated priority order against where the volume actually went.
-- Returns nothing when no sets are logged, which is the honest answer before any
-- training exists — a zero share would read as "you neglected shoulders" when the
-- truth is "you have not trained yet".
create or replace function priority_volume_share(p_days int default 30)
returns table (rank int, muscle_group muscle_group, volume_kg numeric, share_pct numeric)
language sql
stable
as $$
  with vol as (
    select e.muscle_group as mg, sum(coalesce(s.volume_kg, 0)) as v
    from workout_sets s
    join exercises e on e.id = s.exercise_id
    join workout_sessions w on w.id = s.session_id
    where w.performed_on >= current_date - p_days
    group by e.muscle_group
  ),
  total as (select nullif(sum(v), 0) as t from vol)
  select p.rank,
         p.muscle_group,
         round(coalesce(vol.v, 0), 1),
         round(coalesce(vol.v, 0) * 100.0 / total.t, 1)
  from physique_priorities p
  cross join total
  left join vol on vol.mg = p.muscle_group
  where total.t is not null
  order by p.rank;
$$;
