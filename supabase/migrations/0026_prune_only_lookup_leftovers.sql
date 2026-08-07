-- Pruning must never be able to eat the curated library.
--
-- ## What happened
--
-- `prune_unlogged_foods` deleted any food with `times_logged = 0` and no log entries,
-- **whatever its source**. Two guards, and they turned out to be the same guard: both
-- are "has this been eaten?". Clear the food log and every row in the library qualifies
-- at once — including the 223 `source = 'library'` rows imported from the spreadsheet,
-- which the user cannot get back by logging differently.
--
-- That is exactly what occurred: the logs were deleted, `times_logged` was zeroed, and
-- the next prune took 223 of 239 foods. The seed could restore them only because it
-- happens to live in git.
--
-- ## The actual intent
--
-- Its documented purpose is narrower than its implementation: *"Every cache miss writes
-- up to 8 candidate rows, so UNUSED grows with use; that is a prune problem."* It exists
-- to sweep up rows the app created **by itself** during a lookup. So it now deletes only
-- those, and can never touch a curated (`library`), hand-entered (`manual`) or
-- label-scanned (`photo`) food no matter what the log contains.
create or replace function prune_unlogged_foods()
returns integer language plpgsql as $$
declare
  n integer;
begin
  with gone as (
    delete from foods f
    where f.times_logged = 0
      and not exists (select 1 from food_log_entries e where e.food_id = f.id)
      -- Only rows the app wrote for itself while resolving a search.
      and f.source in ('usda', 'openfoodfacts', 'ai_estimate')
    returning 1
  )
  select count(*) into n from gone;
  return n;
end;
$$;

-- The UNUSED count must equal what CLEAR would delete, or the button lies about its
-- own blast radius — which is how a "tidy up 16 leftovers" gesture became a library wipe.
create or replace function library_counts()
returns table (all_count integer, checking_count integer, unlogged_count integer, label_count integer)
language sql stable as $$
  select count(*)::int,
         count(*) filter (where f.confidence <> 'user_verified' and f.source <> 'photo')::int,
         count(*) filter (
           where f.times_logged = 0
             and not exists (select 1 from food_log_entries e where e.food_id = f.id)
             and f.source in ('usda', 'openfoodfacts', 'ai_estimate')
         )::int,
         count(*) filter (where f.source = 'photo')::int
  from foods f;
$$;

notify pgrst, 'reload schema';
