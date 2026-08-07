-- Fix: `unique (name_norm, brand)` does NOT prevent duplicates when brand IS NULL.
--
-- Postgres treats NULLs as distinct in a unique constraint by default, so two
-- rows with the same name_norm and a NULL brand were both accepted — verified
-- against the live DB. That silently reintroduced the exact near-duplicate
-- problem the food library exists to solve (PRD-003 §5.2), and made the seed
-- non-idempotent: every re-run would double every food.
--
-- PRD-001 §3.2 specified `unique (name_norm, coalesce(brand,''))`; the coalesce
-- was lost when 0001 was written. Postgres 15+ expresses the same intent more
-- directly with NULLS NOT DISTINCT.

alter table foods drop constraint if exists foods_name_norm_brand_key;

create unique index if not exists foods_name_brand_key
  on foods (name_norm, brand) nulls not distinct;
