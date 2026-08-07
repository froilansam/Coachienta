-- PR detection inputs and the training trends.
--
-- PR detection itself is NOT here. §4.3 requires it to run **locally on commit**
-- so the stamp appears with no round trip — the set has to lock in under 200 ms
-- offline (AC-2.1), and a server call would break that. So Postgres supplies the
-- prior sets, `lib/domain/train/detectPr.ts` decides, and the verdict travels in
-- the queued payload as `is_pr` / `pr_kinds`.

-- ---------------------------------------------------------------------------
-- 1. Prior working sets at a gym — the evidence PR detection compares against
-- ---------------------------------------------------------------------------
-- Gym-scoped (§3.2): a 45 kg cable stack at one gym is not 45 kg at another, so a
-- cross-gym maximum is not a personal record. Warmups are excluded — beating a
-- warmup is not a PR.
create or replace function prior_sets(p_gym uuid, p_before_session uuid default null)
returns table (
  exercise_id  uuid,
  performed_on date,
  weight_kg    numeric,
  reps         int,
  duration_sec int
)
language sql
stable
as $$
  select s.exercise_id, w.performed_on, s.weight_kg, s.reps, s.duration_sec
  from workout_sets s
  join workout_sessions w on w.id = s.session_id
  where w.gym_id = p_gym
    and s.kind in ('working', 'top')
    -- The session being logged is excluded: a set does not compete with its own
    -- siblings for "personal record", or set 3 would beat set 2 every time.
    and (p_before_session is null or s.session_id <> p_before_session)
  order by s.exercise_id, w.performed_on;
$$;

-- ---------------------------------------------------------------------------
-- 2. Volume by muscle group, weekly (AC-2.14)
-- ---------------------------------------------------------------------------
-- `unattributed` exists so a leak cannot hide behind a zero. The spreadsheet lost
-- 1,802 kg to text spilled into its volume column and nothing noticed; here the
-- difference between the total and the sum of the parts is a returned number.
create or replace function volume_by_muscle(p_gym uuid, p_days int default 84)
returns table (
  week_start   date,
  muscle_group muscle_group,
  volume_kg    numeric,
  set_count    int
)
language sql
stable
as $$
  select date_trunc('week', w.performed_on)::date,
         e.muscle_group,
         round(coalesce(sum(s.volume_kg), 0), 1),
         count(*)::int
  from workout_sets s
  join workout_sessions w on w.id = s.session_id
  join exercises e on e.id = s.exercise_id
  where w.gym_id = p_gym
    and w.performed_on >= current_date - p_days
  group by 1, 2
  having coalesce(sum(s.volume_kg), 0) > 0 or count(*) > 0
  order by 1, 2;
$$;

-- The total, independently, so the parts can be checked against it.
create or replace function volume_total(p_gym uuid, p_days int default 84)
returns table (week_start date, volume_kg numeric, set_count int)
language sql
stable
as $$
  select date_trunc('week', w.performed_on)::date,
         round(coalesce(sum(s.volume_kg), 0), 1),
         count(*)::int
  from workout_sets s
  join workout_sessions w on w.id = s.session_id
  where w.gym_id = p_gym and w.performed_on >= current_date - p_days
  group by 1
  order by 1;
$$;

-- ---------------------------------------------------------------------------
-- 3. PR timeline
-- ---------------------------------------------------------------------------
create or replace function pr_timeline(p_gym uuid, p_days int default 180)
returns table (
  performed_on  date,
  exercise_name text,
  muscle_group  muscle_group,
  pr_kinds      text[],
  weight_kg     numeric,
  reps          int
)
language sql
stable
as $$
  select w.performed_on, e.name, e.muscle_group, s.pr_kinds, s.weight_kg, s.reps
  from workout_sets s
  join workout_sessions w on w.id = s.session_id
  join exercises e on e.id = s.exercise_id
  where w.gym_id = p_gym
    and s.is_pr
    and w.performed_on >= current_date - p_days
  order by w.performed_on desc, e.name;
$$;

-- ---------------------------------------------------------------------------
-- 4. Session frequency, against the 4-day target
-- ---------------------------------------------------------------------------
create or replace function session_frequency(p_days int default 84)
returns table (week_start date, sessions int, volume_kg numeric)
language sql
stable
as $$
  select date_trunc('week', w.performed_on)::date,
         count(distinct w.id)::int,
         round(coalesce(sum(s.volume_kg), 0), 1)
  from workout_sessions w
  left join workout_sets s on s.session_id = w.id
  where w.performed_on >= current_date - p_days
  group by 1
  order by 1;
$$;

-- ---------------------------------------------------------------------------
-- 5. Sessions grouped by date (AC-2.21) and deletion (AC-2.22)
-- ---------------------------------------------------------------------------
-- Listed here rather than in the plan queries because these are history, not
-- planning. `workout_sets` cascades on delete, so removing a session takes its sets
-- with it and every derived figure recomputes — nothing is a stored snapshot.
create or replace function session_list(p_limit int default 60)
returns table (
  id           uuid,
  performed_on date,
  name         text,
  gym_name     text,
  completed_at timestamptz,
  set_count    int,
  volume_kg    numeric,
  pr_count     int
)
language sql
stable
as $$
  select w.id, w.performed_on, w.name, g.name, w.completed_at,
         count(s.id)::int,
         round(coalesce(sum(s.volume_kg), 0), 1),
         count(s.id) filter (where s.is_pr)::int
  from workout_sessions w
  left join gyms g on g.id = w.gym_id
  left join workout_sets s on s.session_id = w.id
  group by w.id, w.performed_on, w.name, g.name, w.completed_at
  order by w.performed_on desc, w.name
  limit p_limit;
$$;
