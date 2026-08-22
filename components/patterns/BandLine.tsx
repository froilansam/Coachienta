import { Text } from '@/components/ui/Text'

/**
 * Daily kcal line with a target band (PRD-003 §5.3).
 *
 * Hairline stroke, no gradient fill. The band is a sunk rectangle spanning the
 * legal target range — Instrument reads a band as paper shading, not a chart
 * library ribbon.
 */
export interface BandPoint {
  on: string
  value: number
  low: number | null
  high: number | null
  label: string
}

const W = 320
const H = 96
const PAD = 4

const ms = (on: string): number => new Date(`${on}T00:00:00`).getTime()

export function BandLine({
  points,
  unit = 'kcal',
  emptyLabel = 'No days logged in this range.',
}: {
  points: readonly BandPoint[]
  unit?: string
  emptyLabel?: string
}) {
  if (points.length === 0) return <Text variant="micro">{emptyLabel}</Text>

  const values = points.flatMap((p) => {
    const xs = [p.value]
    if (p.low !== null) xs.push(p.low)
    if (p.high !== null) xs.push(p.high)
    return xs
  })
  const times = points.map((p) => ms(p.on))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const t0 = Math.min(...times)
  const t1 = Math.max(...times)
  const span = max - min || Math.max(max * 0.02, 1)
  const lo = min - span * 0.12
  const hi = max + span * 0.12
  const width = t1 - t0

  const x = (on: string) => (width === 0 ? W / 2 : PAD + ((ms(on) - t0) / width) * (W - PAD * 2))
  const y = (v: number) => H - PAD - ((v - lo) / (hi - lo)) * (H - PAD * 2)

  const path = [...points]
    .sort((a, b) => a.on.localeCompare(b.on))
    .map((p) => `${x(p.on).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(' ')

  const first = points.reduce((a, b) => (ms(a.on) <= ms(b.on) ? a : b))
  const last = points.reduce((a, b) => (ms(a.on) >= ms(b.on) ? a : b))

  // One representative band from the last day that has targets — bands shift with
  // gym/rest and phase, so drawing every day's band as a polygon would lie.
  const banded = [...points].reverse().find((p) => p.low !== null && p.high !== null)

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-24 w-full overflow-visible"
        role="img"
        aria-label={`Calories from ${Math.round(first.value)} to ${Math.round(last.value)} ${unit} between ${first.on} and ${last.on}`}
      >
        {banded && banded.low !== null && banded.high !== null ? (
          <rect
            x={PAD}
            y={y(banded.high)}
            width={W - PAD * 2}
            height={Math.max(y(banded.low) - y(banded.high), 1)}
            className="fill-sunk"
          />
        ) : null}
        {points.length > 1 ? (
          <polyline
            points={path}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            strokeLinejoin="round"
            className="text-ink-2"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {points.map((p) => (
          <circle
            key={p.on}
            cx={x(p.on)}
            cy={y(p.value)}
            r={1.8}
            className="fill-ink-3"
          />
        ))}
        <circle cx={x(last.on)} cy={y(last.value)} r={2.6} className="fill-accent" />
      </svg>
      <Text variant="micro" tone="secondary">
        {banded && banded.low !== null && banded.high !== null
          ? `Latest target band ${banded.low}–${banded.high} ${unit}. Shaded for the current phase — gym and rest days differ.`
          : `No calorie target band in this range.`}
      </Text>
    </div>
  )
}
