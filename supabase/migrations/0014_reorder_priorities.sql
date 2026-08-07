-- Editing the physique priority order.
--
-- `physique_priorities` has `rank` as its primary key AND `muscle_group` unique,
-- so there is no way to swap two rows one statement at a time: the intermediate
-- state always collides with itself. Replacing the whole list inside one function
-- is the only shape that never sees an invalid intermediate.
--
-- Ranks are always 1..n with no gaps, which is what makes "is my #1 priority
-- actually getting the volume?" answerable (AC-4.14, `priority_volume_share`).
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

  delete from physique_priorities;

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
