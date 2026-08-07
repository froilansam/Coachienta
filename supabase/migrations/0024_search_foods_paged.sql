-- Make `search_foods` pageable — and give it a total order first.
--
-- ## The tiebreaker is the correctness fix; paging is the feature
--
-- The previous ordering was `tier, times_logged desc, sim desc` with **no unique final
-- key**. Rows tying on all three could come back in a different order between two
-- otherwise identical calls, because nothing forced a stable sort. That is harmless
-- while a search returns one page and silently wrong the moment it returns two: page 2
-- would repeat some rows and skip others, and it would do so whether the paging used
-- OFFSET or a keyset cursor. `f.id` last makes the order total.
--
-- Worth stating plainly because it looks like a paging detail and is not: this bug
-- exists today, in a single-page world, any time two foods tie — it is simply invisible
-- because nothing asks for the second page.
--
-- ## Why OFFSET rather than a cursor
--
-- The function is a sequential scan plus a lateral `similarity()` over ~300 rows, with
-- no index serving that ordering. Re-scanning to skip 8 rows costs nothing at this size,
-- and PRD-001 puts the trigram-index threshold at 2,000 rows.
--
-- A keyset cursor would need `(tier, times_logged, sim, id)` round-tripped through the
-- client and compared as a tuple — and it still would not survive `bump_food_usage`
-- changing `times_logged` mid-session. Real complexity, no real guarantee.
--
-- `p_offset` has a default, so every existing caller is untouched: `searchLibrary`
-- passes two arguments, and `resolveCascade`'s photo path passes `limit: 1`. supabase-js
-- sends named parameters, so both keep working unchanged.

drop function if exists search_foods(text, int);
drop function if exists search_foods(text, int, int);

create or replace function search_foods(p_query text, p_limit int default 8, p_offset int default 0)
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
