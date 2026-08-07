'use client'
import { Chip } from '@/components/ui/Chip'
import { ListRow } from '@/components/ui/ListRow'
import { NumericValue } from '@/components/ui/NumericValue'
import { describeRow, trustOf } from '@/lib/domain/food/library'
import type { FoodRow } from '@/lib/schemas/food'

/**
 * One food in the library. Numbers right, provenance left of them — the
 * Bloomberg arrangement the rest of the app uses (PRD-002 §0).
 *
 * The whole row opens the editor. No swipe actions here: delete and merge are
 * both consequential enough to deserve a screen where you can see what you are
 * about to lose, and a hidden gesture is the wrong affordance for either.
 */
export function LibraryRow({ food, onOpen }: { food: FoodRow; onOpen: () => void }) {
  const trust = tone(food)
  return (
    <ListRow
      title={food.brand ? `${food.name} · ${food.brand}` : food.name}
      subtitle={describeRow(food)}
      onClick={onOpen}
      meta={
        <span className="flex items-center gap-2">
          <Chip label={trust.label} tone={trust.tone} size="sm" />
          <NumericValue value={food.kcal} unit="kcal" size="compact" />
          <span className="tabular w-10 text-right font-mono text-2xs text-ink-3">
            {food.times_logged}×
          </span>
        </span>
      }
    />
  )
}

/** `Chip` has no `neutral` warn distinction beyond its own tones, so map here. */
function tone(food: FoodRow) {
  const t = trustOf(food.confidence, food.source)
  return { label: t.label, tone: t.tone === 'neutral' ? ('neutral' as const) : t.tone }
}
