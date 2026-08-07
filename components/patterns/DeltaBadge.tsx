import { cn } from '@/lib/cn'
import { fmtSigned } from '@/lib/format/number'

/**
 * `▲ +8.3` / `▼ −93.3` / `● ON TARGET`
 *
 * `direction` and `state` are SEPARATE props on purpose. Up is not always good:
 * over on protein is good, over on calories during a cut is not. A single
 * `isPositive` flag eventually ships a green arrow celebrating a calorie
 * overshoot (PRD-007 §4.2).
 *
 * The glyph AND the sign are both present so meaning survives colour-blindness
 * and direct sunlight — colour never carries information alone.
 *
 * The number sits in a right-aligned `5ch` column so a stack of these lines up on
 * BOTH edges: the glyph on the left, the unit on the right. Left-aligned, `−75.0 g`
 * and `−290.0 g` put their `g` at different x, and three macro rows read as ragged —
 * which undoes the one thing this design promises (PRD-002 §0).
 */
const GLYPH = { up: '▲', down: '▼', flat: '●' } as const

const STATE = {
  good: { text: 'text-pos', wash: 'bg-pos-wash text-pos' },
  bad: { text: 'text-neg', wash: 'bg-neg-wash text-neg' },
  neutral: { text: 'text-ink-2', wash: 'bg-sunk text-ink-2' },
} as const

export interface DeltaBadgeProps {
  value: number
  unit?: string
  direction: keyof typeof GLYPH
  state: keyof typeof STATE
  /** `wash` = tinted pill (primary emphasis, Bloomberg's % CHANGE column).
   *  `text` = plain coloured text (secondary, their NET CHG column). */
  emphasis?: 'wash' | 'text'
  decimals?: number
}

export function DeltaBadge({
  value,
  unit,
  direction,
  state,
  emphasis = 'text',
  decimals = 1,
}: DeltaBadgeProps) {
  const style = STATE[state]
  return (
    <span
      className={cn(
        'tabular inline-flex items-center gap-1 font-mono text-[13px] font-medium whitespace-nowrap',
        emphasis === 'wash' ? cn('rounded-sm px-1.5 py-0.5', style.wash) : style.text,
      )}
    >
      <span aria-hidden>{GLYPH[direction]}</span>
      {direction === 'flat' ? (
        'ON TARGET'
      ) : (
        <>
          {/* `5ch` fits `−290.0`; anything longer grows rather than clipping. */}
          <span className="min-w-[5ch] text-right">{fmtSigned(value, decimals)}</span>
          {unit ? <span className="text-[0.8em] font-normal opacity-70">{unit}</span> : null}
        </>
      )}
    </span>
  )
}
