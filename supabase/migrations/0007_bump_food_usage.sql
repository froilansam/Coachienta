-- Keeps `recent_foods` ordered by actual use, and remembers the amount you
-- normally take so the Stepper can prefill it (the two-tap path, AC-1.1).
create or replace function bump_food_usage(p_id uuid, p_amount numeric default null)
returns void language sql as $$
  update foods
     set times_logged = times_logged + 1,
         last_used_at = now(),
         -- Only set usual_amount when it is unknown; do not let one odd
         -- portion overwrite an established habit.
         usual_amount = coalesce(usual_amount, p_amount)
   where id = p_id;
$$;
