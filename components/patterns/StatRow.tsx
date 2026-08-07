import { Chip, type ChipProps } from '@/components/ui/Chip'
import { NumericValue } from '@/components/ui/NumericValue'
import { Text } from '@/components/ui/Text'
import { fmtNum } from '@/lib/format/number'
import { DeltaBadge, type DeltaBadgeProps } from './DeltaBadge'

/**
 * The signature component: `PRO   168.3 g   ▲ +8.3   TARGET 160`
 * Powers macro rows, body stats and PR displays.
 *
 * Accessibility requirement: this must announce as ONE sentence —
 * "Protein, 168.3 grams, 8.3 above target of 160" — not four orphaned numbers.
 * That is the biggest screen-reader win in the app (PRD-007 §4.1).
 *
 * **The value and the delta each get a fixed column.** Without them the delta starts
 * wherever the value happens to end, so `−75.0 g` and `−290.0 g` put their `g` at
 * different x positions and a column of three macros reads as ragged. Aligned numbers
 * are the whole premise of this design (PRD-002 §0); a flex row cannot deliver them.
 */
export interface StatRowProps {
  label: string
  value: number | null
  unit?: string
  target?: number
  delta?: Pick<DeltaBadgeProps, 'value' | 'direction' | 'state'>
  chip?: Pick<ChipProps, 'label' | 'tone'>
  decimals?: number
}

function sentence({ label, value, unit, target, delta }: StatRowProps): string {
  if (value === null) return `${label}, no data`
  const parts = [`${label}, ${fmtNum(value)}${unit ? ` ${unit}` : ''}`]
  if (delta && delta.direction !== 'flat') {
    parts.push(`${fmtNum(Math.abs(delta.value))} ${delta.direction === 'up' ? 'above' : 'below'} target`)
  } else if (delta) {
    parts.push('on target')
  }
  if (target !== undefined) parts.push(`target ${fmtNum(target)}`)
  return parts.join(', ')
}

export function StatRow(props: StatRowProps) {
  const { label, value, unit, target, delta, chip, decimals } = props

  return (
    <div className="flex min-h-9 items-baseline gap-3">
      {/* One accessible sentence; the visual pieces are hidden from AT. */}
      <span className="sr-only">{sentence(props)}</span>

      <Text variant="label" className="w-14 shrink-0">
        {label}
      </Text>

      <div aria-hidden className="flex flex-1 items-baseline gap-2.5">
        <span className="w-16 shrink-0">
          <NumericValue value={value} unit={unit} decimals={decimals} />
        </span>
        <span className="w-24 shrink-0">
          {delta ? <DeltaBadge {...delta} unit={unit} /> : null}
        </span>
        {chip ? <Chip {...chip} size="sm" /> : null}
      </div>

      {target !== undefined ? (
        <Text aria-hidden variant="micro" className="shrink-0">
          TARGET <span className="tabular font-mono">{fmtNum(target)}</span>
        </Text>
      ) : null}
    </div>
  )
}
