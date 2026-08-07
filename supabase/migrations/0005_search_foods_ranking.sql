-- Ranking fix for search_foods, found by testing against the real 223-food seed.
--
-- Two defects in 0004:
--
--  1. "rice" did not surface `White rice (cooked)` (110 logs) at all. It is a
--     SUBSTRING, not a prefix, and trigram similarity of a short query against a
--     long name falls under the threshold. The food eaten most was unreachable
--     by its own most obvious search term.
--
--  2. For the typo "chiken breast", `Chicken breast (cooked)` (17 logs) ranked
--     third behind two 1-log foods whose similarity was fractionally higher.
--     Ordering by raw score lets a rare near-match beat a staple.
--
-- Fixes: add a `contains` tier, and order by MATCH TIER first, then
-- times_logged, then score. Within a tier, what this user actually eats wins —
-- which is what AC-1.1's two-tap path depends on.

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
         m.match_kind, r.score
  from foods f
  cross join q
  cross join lateral (
    select
      case
        when f.name_norm = q.nq                                        then 'exact'
        when exists (select 1 from unnest(f.aliases) a
                     where food_name_norm(a) = q.nq)                   then 'alias'
        when f.name_norm like q.nq || '%'                              then 'prefix'
        when f.name_norm like '%' || q.nq || '%'                       then 'contains'
        when exists (select 1 from unnest(f.aliases) a
                     where food_name_norm(a) like '%' || q.nq || '%')  then 'contains'
        when f.name_norm % q.nq                                        then 'fuzzy'
      end as match_kind,
      similarity(f.name_norm, q.nq) as sim
  ) m
  cross join lateral (
    select case m.match_kind
             when 'exact' then 0 when 'alias' then 1 when 'prefix' then 2
             when 'contains' then 3 else 4
           end as tier,
           case m.match_kind
             when 'exact' then 1.0 when 'alias' then 0.95 when 'prefix' then 0.85
             when 'contains' then 0.7 else m.sim
           end::real as score
  ) r
  where q.nq <> '' and m.match_kind is not null
  order by r.tier, f.times_logged desc, m.sim desc
  limit greatest(p_limit, 1);
$$;
