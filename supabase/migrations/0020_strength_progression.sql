-- Strength progression: top set per exercise, per gym, per day.
--
-- One row per (exercise, gym, date) — the heaviest working set of that day, which is
-- what an estimated 1RM should be read from. Epley itself is applied in
-- `lib/domain/train/trends.ts` rather than here: it is arithmetic on two numbers, and
-- keeping it beside the tests that pin it means a formula change is one edit.
--
-- `gym_id` is returned because §4.4 wants **one line per gym**. A cable stack marked
-- 45 kg at one gym is not 45 kg at another (§3.2) — drawing both on a single line
-- would show a step in July that was a change of building, not of strength.
create or replace function strength_progression(p_days int default 180)
returns table (
  exercise_id   uuid,
  exercise_name text,
  muscle_group  muscle_group,
  load_type     load_type,
  gym_id        uuid,
  gym_name      text,
  performed_on  date,
  weight_kg     numeric,
  reps          int,
  duration_sec  int
)
language sql
stable
as $$
  select distinct on (s.exercise_id, w.gym_id, w.performed_on)
         s.exercise_id, e.name, e.muscle_group, e.load_type,
         w.gym_id, g.name, w.performed_on,
         s.weight_kg, s.reps, s.duration_sec
  from workout_sets s
  join workout_sessions w on w.id = s.session_id
  join exercises e on e.id = s.exercise_id
  left join gyms g on g.id = w.gym_id
  where w.performed_on >= current_date - p_days
    -- Warmups and dropsets are not top sets; comparing against them would make the
    -- line jump every time a session opened light.
    and s.kind in ('working', 'top')
  order by s.exercise_id, w.gym_id, w.performed_on,
           -- "Top set" = heaviest, then most reps at that weight. For a duration
           -- exercise the longest hold stands in.
           s.weight_kg desc nulls last, s.duration_sec desc nulls last, s.reps desc nulls last;
$$;

-- Sessions by day, for the frequency calendar. `session_list()` already returns every
-- session with its date, so the grid is built from that — no second query.
