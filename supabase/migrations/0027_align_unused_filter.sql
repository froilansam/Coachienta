-- Two corrections to 0026.
--
-- 1. It rewrote `checking_count` from `confidence in ('medium','low')` to a different
--    predicate while changing the neighbouring count. Restored — that filter had
--    nothing to do with pruning and should not have moved.
-- 2. The UNUSED **list** still selected every never-eaten row while the count and the
--    CLEAR button now only consider lookup leftovers. A tab showing 223 rows above a
--    button that deletes 16 is worse than either number alone.
create or replace function library_counts()
returns table (all_count integer, checking_count integer, unlogged_count integer, label_count integer)
language sql stable as $$
  select
    count(*)::integer,
    count(*) filter (where confidence in ('medium', 'low'))::integer,
    count(*) filter (
      where times_logged = 0
        and not exists (select 1 from food_log_entries e where e.food_id = foods.id)
        and source in ('usda', 'openfoodfacts', 'ai_estimate')
    )::integer,
    count(*) filter (where source = 'photo')::integer
  from foods;
$$;

-- `create or replace` refuses a changed return type, so drop first. The signature is
-- unchanged, so callers are unaffected.
drop function if exists library_foods(text, text, int);

create function library_foods(p_query text default '', p_filter text default 'all', p_limit int default 200)
returns table (
  id uuid, name text, brand text,
  basis_unit unit_basis, basis_amount numeric,
  kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric, fiber_g numeric,
  confidence confidence, source resolution_source, version int,
  times_logged int, usual_amount numeric, last_used_at timestamptz,
  citations jsonb,
  entry_count integer
)
language sql stable as $$
  select f.id, f.name, f.brand, f.basis_unit, f.basis_amount,
         f.kcal, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g,
         f.confidence, f.source, f.version, f.times_logged, f.usual_amount, f.last_used_at,
         f.citations,
         (select count(*)::integer from food_log_entries e where e.food_id = f.id)
  from foods f
  where (
      p_query = ''
      or f.name_norm like '%' || food_name_norm(p_query) || '%'
      or exists (select 1 from unnest(f.aliases) a where food_name_norm(a) like '%' || food_name_norm(p_query) || '%')
    )
    and case p_filter
      when 'checking' then f.confidence in ('medium', 'low')
      -- Never eaten AND written by a lookup. A curated or hand-entered food is not a
      -- search leftover, however long it goes uneaten — and must not be offered for
      -- bulk deletion alongside things that are.
      when 'unlogged' then f.times_logged = 0
                           and not exists (select 1 from food_log_entries e where e.food_id = f.id)
                           and f.source in ('usda', 'openfoodfacts', 'ai_estimate')
      when 'label'    then f.source = 'photo'
      else true
    end
  order by f.times_logged desc, f.name asc
  limit greatest(p_limit, 1);
$$;

notify pgrst, 'reload schema';
