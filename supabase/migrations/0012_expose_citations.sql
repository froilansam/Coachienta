-- Carries `foods.citations` out to the client so provenance can be shown (AC-1.3).
--
-- The column has always been populated — USDA fdcIds with real `fdc.nal.usda.gov`
-- URLs, Open Food Facts barcodes, label reads — but `search_foods` and
-- `library_foods` both declare explicit return tables that omitted it, so nothing
-- reached the UI. A citation nobody can see is the same as no citation: AC-1.3
-- asks for macros "with ≥1 citation URL, or a visible failure", and half of that
-- was unverifiable.
--
-- `recent_foods` already returns `setof foods`, so it needed no change.

-- ---------------------------------------------------------------------------
-- search_foods — unchanged ranking, one extra column
-- ---------------------------------------------------------------------------
drop function if exists search_foods(text, int);

create or replace function search_foods(p_query text, p_limit int default 8)
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
  order by r.tier, f.times_logged desc, m.sim desc
  limit greatest(p_limit, 1);
$$;

-- ---------------------------------------------------------------------------
-- library_foods — same, plus the reference count from 0011
-- ---------------------------------------------------------------------------
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
  citations    jsonb,
  entry_count  integer
)
language sql
stable
as $$
  select
    f.id, f.name, f.brand, f.basis_unit, f.basis_amount,
    f.kcal, f.protein_g, f.carbs_g, f.fat_g, f.fiber_g,
    f.confidence, f.source, f.version, f.times_logged, f.usual_amount,
    f.citations,
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
