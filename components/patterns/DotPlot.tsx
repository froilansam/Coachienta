import { Text } from '@/components/ui/Text'
import { cn } from '@/lib/cn'

/**
 * Events on a date axis, one lane per category.
 *
 * A dot plot rather than a count, because "eleven records" says nothing and eleven
 * dots clustered in one week beside three empty ones says quite a lot. Lanes stay on
 * screen even when empty — an absent lane reads as "no such thing", a present-but-
 * empty lane reads as "you haven't done that", and those are different facts.
 *
 * Agnostic: lanes are whatever the caller names them.
 */
export interface Dot {
  key: string
  on: string
  lane: string
  /** Hover text and the accessible description — names the event, not the pixel. */
  label: string
  emphasis?: boolean
}

export interface Lane {
  key: string
  label: string
}

const PAD = 3

export function DotPlot({
  dots,
  lanes,
  emptyLabel = 'Nothing yet.',
}: {
  dots: readonly Dot[]
  lanes: readonly Lane[]
  emptyLabel?: string
}) {
  if (dots.length === 0) return <Text variant="micro">{emptyLabel}</Text>

  const times = dots.map((d) => new Date(`${d.on}T00:00:00`).getTime())
  const t0 = Math.min(...times)
  const t1 = Math.max(...times)
  const width = t1 - t0

  const left = (on: string) =>
    width === 0 ? 50 : PAD + ((new Date(`${on}T00:00:00`).getTime() - t0) / width) * (100 - PAD * 2)

  const used = lanes.filter((l) => dots.some((d) => d.lane === l.key))

  return (
    <ul className="flex flex-col" aria-label={`${dots.length} events between ${isoOf(t0)} and ${isoOf(t1)}`}>
      {used.map((lane) => {
        const mine = dots.filter((d) => d.lane === lane.key)
        return (
          <li key={lane.key} className="flex items-center gap-3 border-b border-rule py-2 last:border-0">
            <Text variant="label" className="w-16 shrink-0">
              {lane.label}
            </Text>
            <div className="relative h-4 min-w-0 flex-1">
              {/* The axis, so a lone dot still has somewhere to sit. */}
              <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-rule" />
              {mine.map((d) => (
                <span
                  key={d.key}
                  title={`${d.on} · ${d.label}`}
                  aria-label={`${d.on}, ${lane.label}, ${d.label}`}
                  className={cn(
                    'absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full',
                    d.emphasis ? 'bg-accent' : 'bg-ink-3',
                  )}
                  style={{ left: `${left(d.on)}%` }}
                />
              ))}
            </div>
            <Text variant="micro" tone="tertiary" className="w-6 shrink-0 text-right">
              {String(mine.length)}
            </Text>
          </li>
        )
      })}
    </ul>
  )
}

const isoOf = (t: number): string => new Date(t).toISOString().slice(0, 10)
