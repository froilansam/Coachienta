-- Fixes a gate that trusted a counter instead of a reference.
--
-- `foods.times_logged` is a lifetime usage counter, seeded from the spreadsheet's
-- history. It is deliberately NOT the number of rows in `food_log_entries`:
-- `White rice (cooked)` carries 187 because that is how often it was eaten, while
-- only 5 entries were ever imported. That gap is correct and must not be
-- "repaired" — the counter is what orders `recent_foods`, which is what makes the
-- two-tap path work.
--
-- The bug was using it to answer a different question. `0010`'s UI gate asked
-- "is times_logged 0?" when it meant "does anything point at this row?". Result:
-- 221 of 282 foods refused deletion while nothing referenced them, and a food
-- whose only entry had been deleted still reported "in 1 past entry".
--
-- Two changes: expose the real reference count to callers, and decrement the
-- counter when an entry is deleted so log-then-delete stops inflating it.

-- ---------------------------------------------------------------------------
-- 1. Undo a usage bump
-- ---------------------------------------------------------------------------
-- Mirror of `bump_food_usage` for the delete path. Floors at zero: the counter
-- starts from imported history, so a delete must never push it negative.
--
-- `usual_amount` and `last_used_at` are left alone on purpose. A deleted entry
-- was still a real observation of the portion you take, and re-deriving
-- last_used_at would need a scan of the remaining entries for no benefit.
create or replace function unbump_food_usage(p_id uuid)
returns void language sql as $$
  update foods
     set times_logged = greatest(times_logged - 1, 0)
   where id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- 2. Delete a food only if no entry points at it
-- ---------------------------------------------------------------------------
-- The referential check IS the safety property. Returns false rather than
-- raising, so the caller can say "merge instead" without treating it as a fault.
create or replace function delete_food_if_unreferenced(p_id uuid)
returns boolean
language plpgsql
as $$
declare
  removed integer;
begin
  delete from foods f
  where f.id = p_id
    and not exists (select 1 from food_log_entries e where e.food_id = f.id);
  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The library list, now carrying the real reference count
-- ---------------------------------------------------------------------------
-- Return type changes, so the old signature has to go first.
drop function if exists library_foods(text, text, integer);

create or replace function library_foods(
  p_query  text default '',
  p_filter text default 'all',
  p_limit  integer default 200
) returns table (
  id           uuid,
  name         text,
  brand        text,
  basis_unit   unit_basis,
  basis_amount numeric,
  kcal         numeric,
  protein_g    numeric,
  carbs_g      numeric,
  fat_g        numeric,
  fiber_g      numeric,
  confidence   confidence,
  source       resolution_source,
  version      integer,
  times_logged integer,
  usual_amount numeric,
  -- How many log entries actually point here. This is what gates deletion;
  -- `times_logged` only orders the list.
  entry_count  integer
)
language sql
stable
as $$
  select
    f.id, f.name, f.brand, f.basis_unit, f.basis_amount,
    f.kcal, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g,
    f.confidence, f.source, f.version, f.times_logged, f.usual_amount,
    (select count(*) from food_log_entries e where e.food_id = f.id)::integer
  from foods f
  where (
      p_query = ''
      or f.name_norm like '%' || food_name_norm(p_query) || '%'
      or exists (
        select 1 from unnest(f.aliases) a
        where food_name_norm(a) like '%' || food_name_norm(p_query) || '%'
      )
      or coalesce(lower(f.brand), '') like '%' || lower(p_query) || '%'
    )
    and case p_filter
      when 'checking' then f.confidence in ('medium', 'low')
      -- Never eaten: the counter says zero AND nothing references it. Both
      -- halves matter — a food with imported history is not a search leftover.
      when 'unlogged' then f.times_logged = 0
                           and not exists (select 1 from food_log_entries e where e.food_id = f.id)
      when 'label'    then f.source = 'photo'
      else true
    end
  order by f.times_logged desc, f.name asc
  limit p_limit;
$$;
