-- Nutrition aggregation for the coach's SQL tools (PRD-005 §3.2).
--
-- These exist because **an average needs every row, exactly** — the failure PRD-005 §1
-- is built around. Vector search returns the most *similar* days and the model averages
-- those, producing a confident wrong number. SQL over the whole range cannot.
--
-- Two rules carried over from the day screen, because a coach that scores a day
-- differently from the screen is worse than no coach:
--
-- 1. **Targets are selected by the day being measured** — `effective_from <= d and
--    (effective_to is null or effective_to >= d)`. Reading `effective_to is null` would
--    judge July against whatever target happens to be current today, so one phase change
--    would silently re-grade every past day.
-- 2. **A gym day is a day with a session**, and it has different kcal/carb targets from a
--    rest day. Comparing every day to the gym range overstates adherence.

-- The effective target row for a given day. One place, so the three functions below
-- cannot disagree with each other or with `getDay`.
create or replace function target_for_day(p_day date)
returns nutrition_targets
language sql
stable
as $$
  select t.* from nutrition_targets t
  where t.effective_from <= p_day
    and (t.effective_to is null or t.effective_to >= p_day)
  order by t.effective_from desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Per-day (or per-week) totals against the target that applied on the day
-- ---------------------------------------------------------------------------
create or replace function nutrition_summary(
  p_start date,
  p_end date,
  p_group_by text default 'day'
)
returns table (
  bucket        date,
  is_gym_day    boolean,
  kcal          numeric,
  protein_g     numeric,
  carbs_g       numeric,
  fat_g         numeric,
  entry_count   int,
  kcal_target_low  int,
  kcal_target_high int,
  protein_target   int
)
language sql
stable
as $$
  with days as (
    select e.logged_on as d,
           round(sum(e.kcal), 0)      as kcal,
           round(sum(e.protein_g), 1) as protein_g,
           round(sum(e.carbs_g), 1)   as carbs_g,
           round(sum(e.fat_g), 1)     as fat_g,
           count(*)::int              as entry_count,
           exists (select 1 from workout_sessions w where w.performed_on = e.logged_on) as gym
    from food_log_entries e
    where e.logged_on between p_start and p_end
    group by e.logged_on
  ),
  scored as (
    select d.*,
           (target_for_day(d.d)).kcal_gym_low   as k_gym_low,
           (target_for_day(d.d)).kcal_gym_high  as k_gym_high,
           (target_for_day(d.d)).kcal_rest_low  as k_rest_low,
           (target_for_day(d.d)).kcal_rest_high as k_rest_high,
           (target_for_day(d.d)).protein_g      as p_target
    from days d
  )
  select case when p_group_by = 'week' then date_trunc('week', s.d)::date else s.d end,
         -- A week bucket is a gym week if any day in it had a session.
         bool_or(s.gym),
         sum(s.kcal), sum(s.protein_g), sum(s.carbs_g), sum(s.fat_g),
         sum(s.entry_count)::int,
         -- Gym and rest days carry different ranges; a bucket reports the one that
         -- applies to it.
         max(case when s.gym then s.k_gym_low  else s.k_rest_low  end),
         max(case when s.gym then s.k_gym_high else s.k_rest_high end),
         max(s.p_target)
  from scored s
  group by 1
  order by 1;
$$;

-- ---------------------------------------------------------------------------
-- The aggregate the exit criteria name: "average protein last week"
-- ---------------------------------------------------------------------------
-- `logged_days` is returned so the model can state its coverage. PRD-005 §3.2 requires
-- it: without a day count, averaging two logged days and calling it a week reads
-- exactly like averaging seven.
create or replace function nutrition_averages(p_start date, p_end date)
returns table (
  logged_days      int,
  entry_count      int,
  kcal_mean        numeric,
  kcal_sd          numeric,
  protein_mean     numeric,
  protein_median   numeric,
  protein_sd       numeric,
  carbs_mean       numeric,
  fat_mean         numeric,
  protein_target   int,
  days_protein_met int,
  verified_pct     numeric
)
language sql
stable
as $$
  with days as (
    select e.logged_on as d,
           sum(e.kcal) as kcal, sum(e.protein_g) as protein_g,
           sum(e.carbs_g) as carbs_g, sum(e.fat_g) as fat_g,
           count(*)::int as entries,
           count(*) filter (where e.confidence = 'high')::int as verified,
           (target_for_day(e.logged_on)).protein_g as p_target
    from food_log_entries e
    where e.logged_on between p_start and p_end
    group by e.logged_on
  )
  select count(*)::int,
         coalesce(sum(entries), 0)::int,
         round(avg(kcal), 0),
         round(coalesce(stddev_samp(kcal), 0), 1),
         round(avg(protein_g), 1),
         round(percentile_cont(0.5) within group (order by protein_g)::numeric, 1),
         round(coalesce(stddev_samp(protein_g), 0), 1),
         round(avg(carbs_g), 1),
         round(avg(fat_g), 1),
         max(p_target),
         count(*) filter (where p_target is not null and protein_g >= p_target)::int,
         -- Data quality, so an average built on estimates can be flagged as such
         -- rather than quoted as measured (§3.7, "data-quality shortfall").
         case when coalesce(sum(entries), 0) = 0 then 0
              else round(100.0 * sum(verified) / sum(entries), 0) end
  from days;
$$;

-- ---------------------------------------------------------------------------
-- What you actually eat
-- ---------------------------------------------------------------------------
create or replace function food_frequency(p_start date, p_end date, p_limit int default 10)
returns table (
  food_name    text,
  times_logged int,
  total_kcal   numeric,
  total_protein_g numeric,
  kcal_share_pct  numeric
)
language sql
stable
as $$
  with total as (
    select nullif(sum(kcal), 0) as all_kcal from food_log_entries
    where logged_on between p_start and p_end
  )
  select e.food_name,
         count(*)::int,
         round(sum(e.kcal), 0),
         round(sum(e.protein_g), 1),
         round(100.0 * sum(e.kcal) / (select all_kcal from total), 1)
  from food_log_entries e
  where e.logged_on between p_start and p_end
  group by e.food_name
  order by count(*) desc, sum(e.kcal) desc
  limit p_limit;
$$;
