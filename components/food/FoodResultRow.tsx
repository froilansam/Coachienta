'use client'
import { Check, Plus } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { NumericValue } from '@/components/ui/NumericValue'
import { Text } from '@/components/ui/Text'
import { cn } from '@/lib/cn'
import { trustOf } from '@/lib/domain/food/library'
import type { Confidence, ResolutionSource, UnitBasis } from '@/lib/schemas/domain'

/**
 * One search result. Display props only — it knows nothing about `FoodRow`,
 * fetching, or the basket (PRD-007 §2).
 *
 * Macros are shown PER BASIS, following Ultrahuman's
 * "Per 100g — Calories: 32kcal | Fat: 0.30g" row: the basis is visible at the
 * moment of choosing, so you can sanity-check before adding (PRD-002 §0).
 */
export interface FoodResultRowProps {
  name: string
  brand: string | null
  basisAmount: number
  basisUnit: UnitBasis
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
  confidence: Confidence
  /** Provenance decides the chip: "VERIFIED" must mean a human checked it. */
  source: ResolutionSource
  timesLogged: number
  added?: boolean
  onSelect: () => void
}


export function FoodResultRow({
  name, brand, basisAmount, basisUnit, kcal, proteinG, carbsG, fatG,
  confidence, source, timesLogged, added = false, onSelect,
}: FoodResultRowProps) {
  const trust = trustOf(confidence, source)
  const basis = basisUnit === 'piece' || basisUnit === 'serving'
    ? `Per ${basisAmount} ${basisUnit}`
    : `Per ${basisAmount} ${basisUnit}`

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-start gap-3 py-2.5 text-left transition-colors hover:bg-sunk"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <Text variant="body" truncate>{name}</Text>
          <Chip
            label={trust.label}
            tone={trust.tone === 'neutral' ? 'neutral' : trust.tone}
            size="sm"
          />
        </span>

        {brand ? <Text variant="micro">{brand}</Text> : null}

        {/* The basis line — mono so the numbers line up down the list. */}
        <span className="tabular flex flex-wrap items-baseline gap-x-2 font-mono text-2xs text-ink-3">
          <span>{basis}</span>
          <span aria-hidden>·</span>
          <span>{kcal} kcal</span>
          <span>P {proteinG}</span>
          <span>C {carbsG}</span>
          <span>F {fatG}</span>
        </span>
      </span>

      {timesLogged > 0 ? (
        <span className="shrink-0 pt-0.5">
          <NumericValue value={timesLogged} decimals={0} size="compact" tone="tertiary" unit="×" />
        </span>
      ) : null}

      {/* `+` turns into a filled `✓` in place — MyFitnessPal's affordance. */}
      <span
        aria-hidden
        className={cn(
          'mt-0.5 grid size-7 shrink-0 place-items-center rounded-full transition-colors',
          added ? 'bg-accent text-on-accent' : 'bg-sunk text-ink-2',
        )}
      >
        {added ? <Check size={15} strokeWidth={3} /> : <Plus size={15} strokeWidth={2.5} />}
      </span>
    </button>
  )
}
