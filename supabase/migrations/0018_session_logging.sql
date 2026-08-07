-- Live session logging: reading a session's sets, and closing it.
--
-- Sets are written through the offline queue (`/api/data/sync`), not an RPC — the
-- client generates each set's uuid so a replayed flush upserts instead of
-- duplicating (PRD-001 §4.2, AC-2.9). This migration only covers reading them back
-- and finishing the session.

-- One round trip for everything already logged against a session, newest plan
-- position first so the UI can group without a second sort.
create or replace function session_sets(p_session_id uuid)
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
  notes        text,
  volume_kg    numeric
)
language sql
stable
as $$
  select s.id, s.exercise_id, s.position, s.set_index, s.kind,
         s.weight_kg, s.reps, s.duration_sec, s.side, s.rpe,
         s.is_failure, s.is_pr, s.pr_kinds, s.notes, s.volume_kg
  from workout_sets s
  where s.session_id = p_session_id
  order by s.position, s.set_index, s.side nulls first;
$$;

-- Finishing stamps the clock. Idempotent: tapping FINISH twice must not move the
-- time, or the session duration would change every tap.
create or replace function finish_session(p_session_id uuid)
returns workout_sessions
language plpgsql
as $$
declare
  result workout_sessions;
begin
  update workout_sessions
     set completed_at = coalesce(completed_at, now())
   where id = p_session_id
  returning * into result;

  if result.id is null then
    raise exception 'no session with id %', p_session_id;
  end if;
  return result;
end;
$$;
