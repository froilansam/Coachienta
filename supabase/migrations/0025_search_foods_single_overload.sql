-- Leave exactly ONE `search_foods`, and tell PostgREST about it.
--
-- ## What went wrong
--
-- `0024` added `p_offset` with a default and tried to remove the old two-argument
-- version with `drop function if exists search_foods(text, int)`. Both ended up in
-- `pg_proc`, and PostgREST refused every call:
--
--   PGRST203  Could not choose the best candidate function between:
--             search_foods(p_query, p_limit), search_foods(p_query, p_limit, p_offset)
--
-- Every food lookup returned 500 — including names that were sitting in the library —
-- and the UI reported "Lookup failed. Your library still works."
--
-- ## Why this version cannot repeat it
--
-- Naming an exact signature to drop means guessing what is there. This drops **every**
-- overload found in `pg_catalog`, whatever its arguments, so it converges from any
-- prior state and is safe to re-run. `create or replace` cannot be used for the removal
-- itself: it only replaces a function with an identical argument list, so adding a
-- parameter silently creates a second overload rather than replacing the first.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'search_foods'
  loop
    execute format('drop function %s', fn.sig);
  end loop;
end $$;

create function search_foods(p_query text, p_limit int default 8, p_offset int default 0)
returns table (
  id uuid, name text, brand text,
  basis_unit unit_basis, basis_amount numeric,
  kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric, fiber_g numeric,
  confidence confidence, source resolution_source, version int,
  times_logged int, usual_amount numeric,
  citations jsonb,
  match_kind text, score real
)
language sql stable as $$
  with q as (select food_name_norm(p_query) as nq)
  select f.id, f.name, f.brand, f.basis_unit, f.basis_amount,
         f.kcal, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g,
         f.confidence, f.source, f.version, f.times_logged, f.usual_amount,
         f.citations,
         m.match_kind, r.score
  from foods f
  cross join q
  cross join lateral (
    select
      case
        when f.name_norm = q.nq                                        then 'exact'
        when exists (select 1 from unnest(f.aliases) a
                     where food_name_norm(a) = q.nq)                   then 'alias'
        when f.name_norm like '%' || q.nq || '%'                       then 'partial'
        when exists (select 1 from unnest(f.aliases) a
                     where food_name_norm(a) like '%' || q.nq || '%')  then 'partial'
        -- Explicit threshold, not the session-dependent `%` operator.
        when similarity(f.name_norm, q.nq) >= 0.4                      then 'fuzzy'
      end as match_kind,
      similarity(f.name_norm, q.nq) as sim
  ) m
  cross join lateral (
    select case m.match_kind
             when 'exact' then 0 when 'alias' then 1 when 'partial' then 2 else 3
           end as tier,
           case m.match_kind
             when 'exact' then 1.0 when 'alias' then 0.95 when 'partial' then 0.8
             else m.sim
           end::real as score
  ) r
  where q.nq <> '' and m.match_kind is not null
  -- `f.id` last: a total order, so page 2 cannot repeat or skip a row.
  order by r.tier, f.times_logged desc, m.sim desc, f.id
  limit greatest(p_limit, 1) offset greatest(p_offset, 0);
$$;

-- PostgREST caches the schema. A changed function SIGNATURE is invisible to it until
-- it reloads, which is the other half of why `0024` failed in the app while the same
-- SQL worked from a direct psql session.
notify pgrst, 'reload schema';
