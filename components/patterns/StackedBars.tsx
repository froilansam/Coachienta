import { NumericValue } from '@/components/ui/NumericValue'
import { Text } from '@/components/ui/Text'
import { cn } from '@/lib/cn'

/**
 * Horizontal stacked bars — one row per period, one segment per category.
 *
 * Horizontal because twelve vertical bars on a 375 px screen are 24 px wide with
 * rotated labels; a row per week reads at a glance and leaves room for the number.
 *
 * ## The ramp, not a palette
 *
 * PRD-002 §0 allows exactly one hue. Eight categories therefore become one accent
 * plus a descending ink ramp, ordered by size across the WHOLE range so a shade
 * means the same category in every row. A rainbow would need eight semantic colours
 * the design system does not have, and would collide with `pos`/`warn`/`neg`.
 *
 * Knows nothing about muscles, volume or weeks.
 */
export interface BarSegment {
  key: string
  label: string
  value: number
  /** Position in the stable ramp — 0 is the largest category in the range. */
  tint: number
}

export interface Bar {
  key: string
  label: string
  segments: readonly BarSegment[]
  total: number
  /** Rendered in `neg` at the end of the bar. A leak must look like one. */
  unattributed?: number
}

/** 0 is accent; the rest step down the ink ramp. Beyond eight, shades repeat. */
const RAMP = [
  'bg-accent',
  'bg-ink/85',
  'bg-ink/68',
  'bg-ink/54',
  'bg-ink/42',
  'bg-ink/32',
  'bg-ink/24',
  'bg-ink/18',
] as const

export const tintClass = (tint: number): string => RAMP[tint % RAMP.length]!

export function StackedBars({
  bars,
  unit,
  decimals = 0,
  emptyLabel = 'Nothing logged',
}: {
  bars: readonly Bar[]
  unit?: string
  decimals?: number
  emptyLabel?: string
}) {
  // Every bar is scaled against the biggest one, so the rows are comparable to each
  // other rather than each filling its own width.
  const max = bars.reduce((n, b) => Math.max(n, b.total, Math.abs(b.unattributed ?? 0)), 0)

  return (
    <ul className="flex flex-col">
      {bars.map((bar) => {
        const width = max === 0 ? 0 : (bar.total / max) * 100
        return (
          <li key={bar.key} className="flex items-center gap-3 border-b border-rule py-2 last:border-0">
            <Text variant="label" className="w-14 shrink-0">
              {bar.label}
            </Text>

            <div className="flex h-3 min-w-0 flex-1 items-stretch overflow-hidden rounded-[2px] bg-sunk">
              <div className="flex" style={{ width: `${width}%` }}>
                {bar.segments.map((sg) => (
                  <div
                    key={sg.key}
                    /* title, not a tooltip component: this is a hover affordance on a
                       12-px sliver, and the bar's aria-label already carries the
                       full breakdown for anyone not using a mouse. */
                    title={`${sg.label} · ${sg.value.toLocaleString()}${unit ? ` ${unit}` : ''}`}
                    className={cn(tintClass(sg.tint), 'border-r border-surface/60 last:border-0')}
                    style={{ width: `${bar.total === 0 ? 0 : (sg.value / bar.total) * 100}%` }}
                  />
                ))}
              </div>
              {bar.unattributed ? (
                <div
                  title={`Unattributed · ${bar.unattributed.toLocaleString()}`}
                  className="bg-neg"
                  style={{ width: `${max === 0 ? 0 : (Math.abs(bar.unattributed) / max) * 100}%` }}
                />
              ) : null}
            </div>

            <span
              className="w-20 shrink-0 text-right"
              aria-label={
                bar.segments.length === 0
                  ? `${bar.label}: ${emptyLabel}`
                  : `${bar.label}: ${bar.total.toLocaleString()}${unit ? ` ${unit}` : ''} — ${bar.segments
                      .map((s) => `${s.label} ${s.value.toLocaleString()}`)
                      .join(', ')}`
              }
            >
              <NumericValue value={bar.total} decimals={decimals} size="compact" tone="secondary" />
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** The ramp made readable. Doubles as the "what am I looking at" answer. */
export function BarLegend({
  items,
  unit,
}: {
  items: ReadonlyArray<{ key: string; label: string; value: number; tint: number }>
  unit?: string
}) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
      {items.map((it) => (
        <li key={it.key} className="flex items-center gap-1.5">
          <span aria-hidden className={cn(tintClass(it.tint), 'size-2 rounded-[1px]')} />
          <Text variant="micro" tone="secondary">
            {it.label}
          </Text>
          <NumericValue value={it.value} unit={unit} decimals={0} size="compact" tone="tertiary" />
        </li>
      ))}
    </ul>
  )
}
