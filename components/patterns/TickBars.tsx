import { Text } from '@/components/ui/Text'
import { cn } from '@/lib/cn'

/**
 * Daily protein bars with the target as a tick, not a second bar (PRD-003 §5.3).
 * Agnostic: display numbers in, no domain imports.
 */
export interface TickBar {
  key: string
  label: string
  value: number
  /** Absolute position of the tick on the same scale as `value`. */
  tick: number | null
  met: boolean
}

export function TickBars({
  bars,
  unit,
  emptyLabel = 'Nothing logged',
}: {
  bars: readonly TickBar[]
  unit: string
  emptyLabel?: string
}) {
  if (bars.length === 0) return <Text variant="micro">{emptyLabel}</Text>

  const max = bars.reduce((n, b) => Math.max(n, b.value, b.tick ?? 0), 0) || 1

  return (
    <ul className="flex flex-col">
      {bars.map((bar) => {
        const width = (bar.value / max) * 100
        const tickAt = bar.tick === null ? null : (bar.tick / max) * 100
        return (
          <li key={bar.key} className="flex items-center gap-3 border-b border-rule py-1.5 last:border-0">
            <Text variant="label" className="w-14 shrink-0">
              {bar.label}
            </Text>
            <div className="relative h-3 min-w-0 flex-1 rounded-[2px] bg-sunk">
              <div
                className={cn('absolute inset-y-0 left-0 rounded-[2px]', bar.met ? 'bg-accent' : 'bg-ink/40')}
                style={{ width: `${width}%` }}
              />
              {tickAt !== null ? (
                <span
                  aria-hidden
                  className="absolute -top-0.75 -bottom-0.75 w-px bg-ink"
                  style={{ left: `${tickAt}%` }}
                />
              ) : null}
            </div>
            <Text variant="micro" className="w-14 shrink-0 text-right tabular" tone={bar.met ? 'primary' : 'secondary'}>
              {`${Math.round(bar.value)}${unit}`}
            </Text>
          </li>
        )
      })}
    </ul>
  )
}
