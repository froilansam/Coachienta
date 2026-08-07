-- Steps 2-4 of the resolution cascade in one round trip (PRD-003 §3).
--
-- Exact → alias → prefix → trigram, ranked. Doing this in SQL rather than three
-- sequential client calls is what keeps AC-1.1 (p90 < 3 s) reachable.

-- Must match lib/domain/food/normalizeName.ts exactly, or a food inserted by
-- the app will never be found by the app.
create or replace function food_name_norm(p_name text)
returns text language sql immutable parallel safe as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
$$;

create or replace function search_foods(p_query text, p_limit int default 8)
returns table (
  id uuid,
  name text,
  brand text,
  basis_unit unit_basis,
  basis_amount numeric,
  kcal numeric,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  fiber_g numeric,
  confidence confidence,
  source resolution_source,
  version int,
  times_logged int,
  usual_amount numeric,
  match_kind text,
  score real
)
language sql stable as $$
  with q as (select food_name_norm(p_query) as nq)
  select f.id, f.name, f.brand, f.basis_unit, f.basis_amount,
         f.kcal, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g,
         f.confidence, f.source, f.version, f.times_logged, f.usual_amount,
         m.match_kind,
         m.score
  from foods f
  cross join q
  cross join lateral (
    select
      case
        when f.name_norm = q.nq                                       then 'exact'
        when exists (
          select 1 from unnest(f.aliases) a where food_name_norm(a) = q.nq
        )                                                             then 'alias'
        when f.name_norm like q.nq || '%'                             then 'prefix'
        when f.name_norm % q.nq                                       then 'fuzzy'
      end as match_kind,
      case
        when f.name_norm = q.nq                                       then 1.0
        when exists (
          select 1 from unnest(f.aliases) a where food_name_norm(a) = q.nq
        )                                                             then 0.95
        when f.name_norm like q.nq || '%'                             then 0.85
        else similarity(f.name_norm, q.nq)
      end::real as score
  ) m
  where q.nq <> '' and m.match_kind is not null
  -- times_logged breaks ties toward what this user actually eats.
  order by m.score desc, f.times_logged desc
  limit greatest(p_limit, 1);
$$;

-- The default list when the search box is empty. This is the 2-tap path.
create or replace function recent_foods(p_limit int default 8)
returns setof foods language sql stable as $$
  select * from foods
  order by times_logged desc, coalesce(last_used_at, 'epoch'::timestamptz) desc
  limit greatest(p_limit, 1);
$$;

-- Trigram threshold: 0.3 is the Postgres default and too loose for short food
-- names — it matched almost everything. 0.45 keeps "chiken"→"chicken" while
-- rejecting unrelated words.
select set_limit(0.45);
