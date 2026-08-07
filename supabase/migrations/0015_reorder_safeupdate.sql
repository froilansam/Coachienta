-- Fixes `reorder_physique_priorities` for calls that arrive through PostgREST.
--
-- Supabase runs the API role with **pg_safeupdate**, which rejects any DELETE or
-- UPDATE without a WHERE clause. `0014`'s bare `delete from physique_priorities`
-- therefore worked from a direct psql session and failed with
-- "DELETE requires a WHERE clause" through `/api/data/goals` — the probe passed
-- and the feature did not.
--
-- `where rank >= 1` is not decoration: ranks are always 1..n, so it selects every
-- row while satisfying the guard.
create or replace function reorder_physique_priorities(
  p_groups muscle_group[],
  p_notes  text[] default null
) returns setof physique_priorities
language plpgsql
as $$
begin
  if array_length(p_groups, 1) is null then
    raise exception 'the priority order cannot be empty';
  end if;

  -- A duplicate would violate the unique index halfway through and leave the
  -- table truncated, so it is refused before anything is deleted.
  if array_length(p_groups, 1) <> (select count(distinct g) from unnest(p_groups) g) then
    raise exception 'a muscle group can appear only once in the priority order';
  end if;

  delete from physique_priorities where rank >= 1;

  insert into physique_priorities (rank, muscle_group, note)
  select ordinality::int,
         g,
         case
           when p_notes is null then null
           else nullif(p_notes[ordinality], '')
         end
  from unnest(p_groups) with ordinality as t(g, ordinality);

  return query select * from physique_priorities order by rank;
end;
$$;
