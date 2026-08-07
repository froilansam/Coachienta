'use client'
import { AlertTriangle } from 'lucide-react'
import { NumericValue } from '@/components/ui/NumericValue'
import { Rule } from '@/components/ui/Rule'
import { Text } from '@/components/ui/Text'
import type { CurrentMetric } from '@/hooks/useProfile'
import type { EnergyEstimate } from '@/lib/domain/coach/energy'

/**
 * CURRENT: what your body is doing right now, each value dated by the reading
 * that produced it.
 *
 * The dates differ per row on purpose — latest-wins is per FIELD, not per row, so
 * a partial weigh-in does not blank a waist measurement you actually have
 * (AC-4.4b, `lib/domain/body.ts`).
 */
export function CurrentStrip({
  metrics,
  energy,
}: {
  metrics: readonly CurrentMetric[]
  energy: EnergyEstimate
}) {
  return (
    <div className="flex flex-col">
      <Rule />
      {metrics.map((m) => (
        <div key={m.label} className="flex flex-col gap-0.5 py-2">
          <div className="flex items-baseline justify-between gap-3">
            <Text variant="label">{m.label}</Text>
            {m.latest ? (
              <span className="flex items-baseline gap-3">
                <NumericValue value={m.latest.value} unit={m.unit} decimals={m.decimals} />
                <span className="tabular w-20 text-right font-mono text-2xs text-ink-3">
                  {m.latest.on}
                </span>
              </span>
            ) : (
              <Text variant="micro">never logged</Text>
            )}
          </div>
          {/* Inline at the offending value, not collected into a banner. */}
          {m.warning ? (
            <span className="flex items-center gap-1 self-end text-warn">
              <AlertTriangle size={11} strokeWidth={2.5} aria-hidden />
              <Text variant="micro">{m.warning}</Text>
            </span>
          ) : null}
        </div>
      ))}

      <Rule />
      <div className="flex flex-col gap-0.5 py-2">
        <div className="flex items-baseline justify-between gap-3">
          <Text variant="label">BMR est.</Text>
          {energy.ok ? (
            <NumericValue value={energy.bmr} unit="kcal" decimals={0} />
          ) : (
            <Text variant="micro">—</Text>
          )}
        </div>
        {energy.ok ? (
          <Text variant="micro">
            {/* Both methods named. Neither is authoritative, and picking one
                silently would be the spreadsheet's mistake again. */}
            {`Mifflin-St Jeor at age ${energy.age}${
              energy.scaleBmr !== null ? ` · your scale says ${energy.scaleBmr}` : ''
            } · TDEE ≈ ${energy.tdee}`}
          </Text>
        ) : (
          <Text variant="micro">{energy.blocked}</Text>
        )}
      </div>
    </div>
  )
}
