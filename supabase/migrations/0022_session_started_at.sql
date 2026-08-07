-- A session's duration, stored rather than guessed.
--
-- PRD-004 §4.3a's mock shows `42m · 4,180 kg · 14 sets`, and until now the schema
-- could not produce the `42m`: only `completed_at` existed, and the live screen's
-- elapsed clock counts from when the SCREEN mounted, which is not when the session
-- began. Rather than print a plausible number, the column now exists.
--
-- Deliberately nullable with a default rather than backfilled. Sessions imported
-- from the spreadsheet genuinely have no start time, and the app's rule is that a
-- missing value renders as a dash and never as 0 — a fabricated 42 minutes would be
-- exactly the kind of number the spreadsheet was full of.
alter table workout_sessions
  add column if not exists started_at timestamptz;

-- `start_session` inserts the row, so a column default covers every new session with
-- no change to the RPC.
alter table workout_sessions
  alter column started_at set default now();

-- Re-declared to return it. `drop` first: the return type changes.
drop function if exists session_list(int);
create function session_list(p_limit int default 60)
returns table (
  id           uuid,
  performed_on date,
  name         text,
  gym_name     text,
  started_at   timestamptz,
  completed_at timestamptz,
  set_count    int,
  volume_kg    numeric,
  pr_count     int
)
language sql
stable
as $$
  select w.id, w.performed_on, w.name, g.name, w.started_at, w.completed_at,
         count(s.id)::int,
         round(coalesce(sum(s.volume_kg), 0), 1),
         count(s.id) filter (where s.is_pr)::int
  from workout_sessions w
  left join gyms g on g.id = w.gym_id
  left join workout_sets s on s.session_id = w.id
  group by w.id, w.performed_on, w.name, g.name, w.started_at, w.completed_at
  order by w.performed_on desc, w.started_at desc nulls last, w.name
  limit p_limit;
$$;
