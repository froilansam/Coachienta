-- Re-grade foods wrongly marked `low` by the naive Atwater check.
--
-- USDA reports "Carbohydrate, by difference", which INCLUDES fiber, but fiber
-- yields ~2 kcal/g not 4. The old 4·carbs formula overestimated every
-- high-fiber food, so vegetables, legumes and whole grains were all flagged
-- UNVERIFIED. Verified on raw broccoli: 24% off naive, 8% off fiber-aware.
--
-- Mirrors lib/domain/macros.ts `validateMacroRate` exactly.

with graded as (
  select id,
         source,
         abs(
           (4 * protein_g
            + 4 * greatest(carbs_g - coalesce(fiber_g, 0), 0)
            + 9 * fat_g
            + 2 * coalesce(fiber_g, 0)) - kcal
         ) / greatest(kcal, 1) as off_by
  from foods
  where confidence = 'low'
)
update foods f
   set confidence = case when g.source = 'ai_estimate' then 'medium'::confidence
                         else 'high'::confidence end
  from graded g
 where f.id = g.id
   and g.off_by <= 0.20;
