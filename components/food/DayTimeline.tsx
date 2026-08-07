'use client'
import { Chip } from '@/components/ui/Chip'
import { ListRow } from '@/components/ui/ListRow'
import { NumericValue } from '@/components/ui/NumericValue'
import { Rule } from '@/components/ui/Rule'
import { Text } from '@/components/ui/Text'
import type { MealGroup } from '@/lib/domain/food/dayView'

/**
 * Entries grouped by meal, each with its own subtotal and macro line.
 *
 * Per-meal subtotals came out of the Mobbin pass (MyFitnessPal) — a day total
 * alone cannot tell you which meal spent the fat budget (PRD-002 §0).
 */
const TIME = (iso: string | null): string | undefined =>
  iso
    ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : undefined

export function DayTimeline({
  groups,
  onRemove,
}: {
  groups: readonly MealGroup[]
  onRemove: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <section key={g.meal} className="flex flex-col">
          <div className="flex items-baseline justify-between gap-3">
            <Text variant="label">{g.meal}</Text>
            <NumericValue value={g.totals.kcal} decimals={0} />
          </div>

          {/* Per-meal macro line, tertiary so it never competes with the day totals. */}
          <Text variant="micro" className="tabular font-mono">
            {`P ${g.totals.protein_g}   C ${g.totals.carbs_g}   F ${g.totals.fat_g}`}
          </Text>

          <Rule />

          {g.entries.map((e) => (
            <ListRow
              key={e.id}
              title={e.foodName}
              subtitle={[
                e.amount > 0 ? `${e.amount}${e.unit === 'piece' ? '' : e.unit}` : null,
                TIME(e.loggedAt),
              ]
                .filter(Boolean)
                .join(' · ')}
              lang={/[　-鿿＀-￯]/.test(e.foodName) ? 'ja' : undefined}
              meta={
                <span className="flex items-center gap-2">
                  {e.pending ? <Chip label="Pending" tone="warn" size="sm" /> : null}
                  {e.confidence === 'low' ? <Chip label="Unverified" tone="warn" size="sm" /> : null}
                  {e.confidence === 'medium' ? <Chip label="Est" tone="warn" size="sm" /> : null}
                  <NumericValue value={e.kcal} decimals={0} />
                </span>
              }
              swipeActions={[{ label: 'Delete', tone: 'negative', onAction: () => onRemove(e.id) }]}
            />
          ))}
        </section>
      ))}
    </div>
  )
}
