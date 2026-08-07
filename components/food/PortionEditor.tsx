'use client'
import { SourceList, type Source } from '@/components/patterns/SourceList'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { NumericValue } from '@/components/ui/NumericValue'
import { Rule } from '@/components/ui/Rule'
import { Stepper } from '@/components/ui/Stepper'
import { Text } from '@/components/ui/Text'
import type { Macros, UnitBasis } from '@/lib/schemas/domain'

/**
 * Portion step: pick the amount, see the macros change live.
 *
 * Presets are the detail that makes this fast — derived from the food's own
 * logging history, so the common case is one tap rather than typing
 * (PRD-007 §3.7).
 */
export interface PortionEditorProps {
  name: string
  amount: number
  unit: UnitBasis
  step: number
  presets: readonly number[]
  macros: Macros
  /** Warn on an implausible amount rather than silently accepting it (PRD-003 §7). */
  warning?: string | null
  /**
   * Where these macros came from. Shown here rather than in the result row
   * because this is the last screen before you accept the number — and because a
   * result row is a tap target, so a link inside it would be a button in a button
   * (AC-1.3).
   */
  sources?: readonly Source[]
  onAmountChange: (v: number | null) => void
  onConfirm: () => void
  onCancel: () => void
}

export function PortionEditor({
  name, amount, unit, step, presets, macros, warning, sources = [],
  onAmountChange, onConfirm, onCancel,
}: PortionEditorProps) {
  return (
    <div className="flex flex-col gap-4 py-1">
      <div className="flex items-start justify-between gap-3">
        <Text variant="body" className="flex-1">{name}</Text>
        <Button variant="ghost" size="sm" onClick={onCancel}>Back</Button>
      </div>

      <Stepper
        label={`Amount in ${unit}`}
        value={amount}
        onChange={onAmountChange}
        unit={unit}
        step={step}
        min={0}
        presets={presets}
      />

      {warning ? <Chip label={warning} tone="warn" /> : null}

      <Rule />

      {/* Live preview. Recomputed by the hook, never in this JSX. */}
      <div className="flex items-baseline justify-between gap-4">
        <NumericValue value={macros.kcal} unit="kcal" size="metric" />
        <dl className="tabular flex gap-4 font-mono text-sm">
          {([['P', macros.protein_g], ['C', macros.carbs_g], ['F', macros.fat_g]] as const).map(
            ([label, v]) => (
              <div key={label} className="flex items-baseline gap-1">
                <dt className="text-ink-3">{label}</dt>
                <dd><NumericValue value={v} size="compact" /></dd>
              </div>
            ),
          )}
        </dl>
      </div>

      {/* Between the numbers and the commit: the last place a doubt can be
          answered before the number becomes a log entry. */}
      <SourceList sources={sources} emptyLabel="No source recorded — you entered these numbers." />

      <Button variant="primary" size="lg" fullWidth onClick={onConfirm}>
        ADD
      </Button>
    </div>
  )
}
