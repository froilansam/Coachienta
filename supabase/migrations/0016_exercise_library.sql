-- The exercise library: reading it with usage, and editing it safely.
--
-- `set_count` is the reason this is an RPC rather than a plain select. Changing an
-- exercise's `load_type` changes what its recorded metrics MEAN — `assisted` sets
-- have no volume because lower assist is better, so multiplying inverts it
-- (PRD-004 §3.1). The editor must be able to say "this would reinterpret 42
-- logged sets" before you save, and that needs the count alongside the row.

-- Mirrors `food_name_norm`. `exercises.name_norm` is unique, so it needs the same
-- whitespace-and-case normalisation to make "DB Row" and "db  row" collide.
create or replace function exercise_name_norm(p_name text)
returns text language sql immutable parallel safe as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
$$;

create or replace function exercise_library(p_include_inactive boolean default false)
returns table (
  id               uuid,
  name             text,
  aliases          text[],
  muscle_group     muscle_group,
  movement_pattern movement_pattern,
  load_type        load_type,
  is_unilateral    boolean,
  equipment        text,
  is_active        boolean,
  -- How many logged sets reference this exercise. Gates the load_type warning and
  -- deletion, for the same reason `entry_count` gates a food delete (migration
  -- 0011): a counter can be wrong, a reference cannot.
  set_count        integer,
  last_performed_on date
)
language sql
stable
as $$
  select
    e.id, e.name, e.aliases, e.muscle_group, e.movement_pattern, e.load_type,
    e.is_unilateral, e.equipment, e.is_active,
    (select count(*) from workout_sets s where s.exercise_id = e.id)::integer,
    (select max(w.performed_on)
       from workout_sets s
       join workout_sessions w on w.id = s.session_id
      where s.exercise_id = e.id)
  from exercises e
  where p_include_inactive or e.is_active
  order by e.muscle_group, e.name;
$$;

-- ---------------------------------------------------------------------------
-- Editing
-- ---------------------------------------------------------------------------
-- Plain update, not a supersede: an exercise's identity does not change when you
-- correct its muscle group. Historical sets keep pointing at the same row, which
-- is what you want — a chest press mis-tagged `back_mid` should retroactively
-- count toward chest, because it always WAS a chest press. That is the opposite of
-- the food rule (§4.3), where a macro correction must not rewrite history: there
-- the entry froze a measurement, here the row records a fact about the movement.
create or replace function update_exercise(
  p_id               uuid,
  p_name             text,
  p_muscle_group     muscle_group,
  p_movement_pattern movement_pattern,
  p_load_type        load_type,
  p_is_unilateral    boolean,
  p_equipment        text,
  p_aliases          text[] default '{}'
) returns exercises
language plpgsql
as $$
declare
  result exercises;
begin
  update exercises set
    name             = p_name,
    name_norm        = exercise_name_norm(p_name),
    muscle_group     = p_muscle_group,
    movement_pattern = p_movement_pattern,
    load_type        = p_load_type,
    is_unilateral    = p_is_unilateral,
    equipment        = nullif(btrim(coalesce(p_equipment, '')), ''),
    aliases          = coalesce(p_aliases, '{}')
  where id = p_id
  returning * into result;

  if result.id is null then
    raise exception 'no exercise with id %', p_id;
  end if;
  return result;
end;
$$;

create or replace function add_exercise(
  p_name             text,
  p_muscle_group     muscle_group,
  p_movement_pattern movement_pattern,
  p_load_type        load_type,
  p_is_unilateral    boolean default false,
  p_equipment        text default null
) returns exercises
language plpgsql
as $$
declare
  result exercises;
begin
  insert into exercises (name, name_norm, muscle_group, movement_pattern, load_type,
                         is_unilateral, equipment)
  values (p_name, exercise_name_norm(p_name), p_muscle_group, p_movement_pattern,
          p_load_type, p_is_unilateral, nullif(btrim(coalesce(p_equipment, '')), ''))
  returning * into result;
  return result;
end;
$$;

-- Retire, never delete. An exercise with logged sets must keep existing or the
-- history it explains becomes unreadable; one with none is still worth keeping out
-- of the picker rather than destroying. `is_active` does both.
create or replace function set_exercise_active(p_id uuid, p_active boolean)
returns void
language sql
as $$
  update exercises set is_active = p_active where id = p_id;
$$;
