'use client'
import { DeltaBadge } from '@/components/patterns/DeltaBadge'
import { EquationRow } from '@/components/patterns/EquationRow'
import { StatRow } from '@/components/patterns/StatRow'
import { ProgressTrack } from '@/components/ui/ProgressTrack'
import { Rule } from '@/components/ui/Rule'
import { Text } from '@/components/ui/Text'
import type { MacroRow } from '@/lib/domain/food/dayView'

/**
 * The glanceable block: visible arithmetic, then one row per macro with its
 * delta. Display props only — every number is already graded by the hook.
 */
export function MacroSummary({
  equation,
  kcal,
  macros,
  pct,
}: {
  equation: Array<{ label: string; value: number; operator?: '−' | '=' }>
  kcal: MacroRow
  macros: readonly MacroRow[]
  pct: number
}) {
  return (
    <section className="flex flex-col gap-3">
      <EquationRow terms={equation} />

      <div className="flex items-center gap-3">
        <ProgressTrack
          pct={pct}
          tone={kcal.delta.state === 'good' ? 'accent' : pct > 100 ? 'warn' : 'accent'}
          label={`Calories ${pct}% of target`}
        />
        <Text variant="micro" className="tabular w-9 shrink-0 text-right font-mono">
          {pct}%
        </Text>
      </div>

      <Rule />

      <div className="flex flex-col gap-1">
        {macros.map((m) => (
          <StatRow
            key={m.label}
            label={m.label}
            value={m.value}
            unit={m.unit}
            target={m.target}
            delta={m.delta}
          />
        ))}
      </div>
    </section>
  )
}

/** Compact variant for the day header, where space is tight. */
export function KcalHeadline({ kcal }: { kcal: MacroRow }) {
  return (
    <div className="flex items-baseline gap-2">
      <Text variant="label">KCAL</Text>
      <DeltaBadge {...kcal.delta} unit="kcal" emphasis="wash" />
    </div>
  )
}
