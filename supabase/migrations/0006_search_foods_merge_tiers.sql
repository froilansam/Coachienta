-- Merge the `prefix` and `contains` tiers into one `partial` tier.
--
-- Testing "egg" against the real seed put two 1-log prefix matches
-- ("Eggs (3 pcs)", "Egg with mushroom") above `Sunny side up eggs` (27 logs),
-- because prefix outranked contains regardless of frequency.
--
-- Searching your OWN 223 foods, prefix-vs-substring is a distinction without
-- value — how often you eat something is the far stronger signal. One tier,
-- ordered by times_logged.

create or replace function search_foods(p_query text, p_limit int default 8)
returns table (
  id uuid, name text, brand text,
  basis_unit unit_basis, basis_amount numeric,
  kcal numeric, protein_g numeric, carbs_g numeric, fat_g numeric, fiber_g numeric,
  confidence confidence, source resolution_source, version int,
  times_logged int, usual_amount numeric,
  match_kind text, score real
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
        when f.name_norm like '%' || q.nq || '%'                       then 'partial'
        when exists (select 1 from unnest(f.aliases) a
                     where food_name_norm(a) like '%' || q.nq || '%')  then 'partial'
        when f.name_norm % q.nq                                        then 'fuzzy'
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
  order by r.tier, f.times_logged desc, m.sim desc
  limit greatest(p_limit, 1);
$$;
