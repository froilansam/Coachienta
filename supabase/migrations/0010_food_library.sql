-- Food library management: correct, prune, merge.
--
-- All three are RPCs rather than client-side updates because each is several
-- statements that must not half-apply, and because `version = version + 1` is an
-- expression supabase-js cannot send. Read-then-write would also lose a
-- concurrent edit — unlikely with one user, but free to avoid.

-- ---------------------------------------------------------------------------
-- 1. Correct a food's macros (PRD-003 §4.3, AC-1.6)
-- ---------------------------------------------------------------------------
-- Bumps `version` and marks the row `user_verified`. Deliberately touches ONLY
-- `foods`: existing `food_log_entries` keep their frozen macros and their old
-- `food_version`, so no chart ever moves under the user. That immutability is
-- the whole reason macros are copied into the entry at log time.
create or replace function update_food_macros(
  p_id          uuid,
  p_name        text,
  p_brand       text,
  p_basis_unit  unit_basis,
  p_basis_amount numeric,
  p_kcal        numeric,
  p_protein_g   numeric,
  p_carbs_g     numeric,
  p_fat_g       numeric,
  p_fiber_g     numeric,
  p_confidence  confidence default 'user_verified'
) returns foods
language plpgsql
as $$
declare
  result foods;
begin
  update foods set
    name         = p_name,
    name_norm    = food_name_norm(p_name),
    brand        = p_brand,
    basis_unit   = p_basis_unit,
    basis_amount = p_basis_amount,
    kcal         = p_kcal,
    protein_g    = p_protein_g,
    carbs_g      = p_carbs_g,
    fat_g        = p_fat_g,
    fiber_g      = p_fiber_g,
    confidence   = p_confidence,
    version      = version + 1
  where id = p_id
  returning * into result;

  if result.id is null then
    raise exception 'no food with id %', p_id;
  end if;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Prune foods that were never eaten
-- ---------------------------------------------------------------------------
-- Every cache miss writes up to 8 candidate rows, so the library accumulates
-- food that was looked at once and never logged. Measured on real data: 58 of
-- 282 rows (21%).
--
-- The `not exists` guard is the safety property, not `times_logged = 0` — a
-- counter can be wrong, a foreign key cannot. Anything a log entry points at
-- survives regardless of what its counter says.
create or replace function prune_unlogged_foods()
returns integer
language plpgsql
as $$
declare
  n integer;
begin
  with gone as (
    delete from foods f
    where f.times_logged = 0
      and not exists (select 1 from food_log_entries e where e.food_id = f.id)
    returning 1
  )
  select count(*) into n from gone;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Merge two foods (US-1.10, AC-1.13)
-- ---------------------------------------------------------------------------
-- The loser's name and aliases move into the survivor's `aliases`, so the old
-- spelling still finds the row via cascade step 3. Log entries are repointed and
-- `times_logged` is summed, which keeps `recent_foods` ordering honest.
--
-- Historical macros are NOT rewritten. `food_log_entries` carries its own frozen
-- copy; only `food_id` changes. Same rule as a correction (§4.3).
create or replace function merge_foods(p_survivor uuid, p_loser uuid)
returns foods
language plpgsql
as $$
declare
  survivor foods;
  loser    foods;
  moved    integer;
begin
  if p_survivor = p_loser then
    raise exception 'cannot merge a food into itself';
  end if;

  select * into survivor from foods where id = p_survivor;
  select * into loser    from foods where id = p_loser;
  if survivor.id is null or loser.id is null then
    raise exception 'both foods must exist';
  end if;

  -- Refuse across bases. Merging a per-piece row into a per-100 g row would
  -- silently reinterpret every historical amount, and there is no density to
  -- convert with (PRD-003 §4.1 — we ask rather than guess).
  if survivor.basis_unit <> loser.basis_unit then
    raise exception 'cannot merge % basis into % basis', loser.basis_unit, survivor.basis_unit;
  end if;

  update food_log_entries set food_id = p_survivor where food_id = p_loser;
  get diagnostics moved = row_count;

  update foods set
    aliases = (
      select array_agg(distinct a)
      from unnest(survivor.aliases || loser.aliases || array[loser.name]) as a
      where a is not null and food_name_norm(a) <> survivor.name_norm
    ),
    times_logged = survivor.times_logged + loser.times_logged,
    -- A merge is an editorial act, so it counts as a version bump for the same
    -- reason a correction does: the row now means something slightly different.
    version = survivor.version + 1
  where id = p_survivor
  returning * into survivor;

  delete from foods where id = p_loser;

  raise notice 'merged % into %, moved % entries', loser.name, survivor.name, moved;
  return survivor;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The library list
-- ---------------------------------------------------------------------------
-- One function for every filter the screen offers, so the ordering rule lives in
-- exactly one place. `p_filter`:
--   'all'      — everything, most-used first
--   'checking' — confidence medium or low: the 67% that nobody has confirmed
--   'unlogged' — never eaten: the prune candidates
--   'label'    — read from a photographed nutrition panel
create or replace function library_foods(
  p_query  text default '',
  p_filter text default 'all',
  p_limit  integer default 200
) returns setof foods
language sql
stable
as $$
  select *
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
      when 'unlogged' then f.times_logged = 0
                           and not exists (select 1 from food_log_entries e where e.food_id = f.id)
      when 'label'    then f.source = 'photo'
      else true
    end
  order by f.times_logged desc, f.name asc
  limit p_limit;
$$;

-- Counts for the filter chips. One round trip instead of four.
create or replace function library_counts()
returns table (all_count integer, checking_count integer, unlogged_count integer, label_count integer)
language sql
stable
as $$
  select
    count(*)::integer,
    count(*) filter (where confidence in ('medium', 'low'))::integer,
    count(*) filter (
      where times_logged = 0
        and not exists (select 1 from food_log_entries e where e.food_id = foods.id)
    )::integer,
    count(*) filter (where source = 'photo')::integer
  from foods;
$$;
