'use client'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { NumericValue } from '@/components/ui/NumericValue'
import { Text } from '@/components/ui/Text'
import type { Macros } from '@/lib/schemas/domain'

/**
 * Removable chips plus a running total, then one primary action.
 *
 * Ultrahuman stacks selected foods as dismissible chips above the keyboard so
 * you can keep searching and commit once — a better answer to multi-item logging
 * than parsing a comma-separated sentence (PRD-002 §0).
 */
export interface BasketFooterProps {
  items: ReadonlyArray<{ id: string; label: string }>
  totals: Macros
  isCommitting: boolean
  onRemove: (id: string) => void
  onCommit: () => void
}

export function BasketFooter({ items, totals, isCommitting, onRemove, onCommit }: BasketFooterProps) {
  if (items.length === 0) {
    return (
      <Text variant="micro">
        Pick a food to start. Nothing is saved until you tap LOG.
      </Text>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <Chip key={i.id} label={i.label} onRemove={() => onRemove(i.id)} />
        ))}
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <Text variant="label">TOTAL</Text>
        <span className="tabular flex items-baseline gap-3 font-mono text-sm">
          <NumericValue value={totals.kcal} unit="kcal" />
          <span className="text-ink-3">P {totals.protein_g}</span>
          <span className="text-ink-3">C {totals.carbs_g}</span>
          <span className="text-ink-3">F {totals.fat_g}</span>
        </span>
      </div>

      <Button variant="primary" size="lg" fullWidth loading={isCommitting} onClick={onCommit}>
        {`LOG ${items.length} ITEM${items.length > 1 ? 'S' : ''}`}
      </Button>
    </div>
  )
}
