'use client'
import { Text } from '@/components/ui/Text'
import type { Series } from '@/lib/domain/body'

/**
 * A measurement over time. Hairline stroke, no fill, no gradient — the Instrument
 * aesthetic reads a trend as a line on paper, not a dashboard widget (PRD-002 §0,
 * where circular rings and gradient fills were explicitly rejected).
 *
 * Inline SVG rather than a charting library: this draws one polyline and a few
 * dots, and the smallest chart library is larger than the whole component tree it
 * would live in.
 *
 * **Missing readings are gaps, not zeros** (AC-4.4c). `seriesOf` has already
 * dropped nulls, and points are placed by their DATE, so a fortnight without a
 * body-fat reading shows as a long flat segment between two real dots rather than
 * a plunge to 0%.
 */
const W = 320
const H = 48
const PAD = 3

export function TrendChart({
  series,
  label,
  unit,
  decimals = 1,
}: {
  series: Series | null
  label: string
  unit: string
  decimals?: number
}) {
  if (!series || series.points.length === 0) {
    return <Text variant="micro">{`No ${label.toLowerCase()} readings in this range.`}</Text>
  }

  const { points, min, max } = series
  const first = points[0]!
  const last = points[points.length - 1]!

  // A flat series would divide by zero; give it a band so the line sits centred.
  const span = max - min || Math.max(max * 0.02, 1)
  const lo = min - span * 0.15
  const hi = max + span * 0.15

  const t0 = new Date(`${first.on}T00:00:00`).getTime()
  const t1 = new Date(`${last.on}T00:00:00`).getTime()
  const width = t1 - t0

  const x = (on: string) =>
    width === 0
      ? W / 2
      : PAD + ((new Date(`${on}T00:00:00`).getTime() - t0) / width) * (W - PAD * 2)
  const y = (v: number) => H - PAD - ((v - lo) / (hi - lo)) * (H - PAD * 2)

  const path = points.map((p) => `${x(p.on).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
  const fmt = (v: number) => v.toFixed(decimals)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-12 w-full overflow-visible"
      role="img"
      /* One sentence that carries the whole chart, since an SVG polyline is
         invisible to a screen reader. */
      aria-label={`${label}: ${points.length} readings from ${fmt(first.value)} to ${fmt(last.value)} ${unit} between ${first.on} and ${last.on}`}
    >
      <polyline
        points={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinejoin="round"
        className="text-ink-2"
        vectorEffect="non-scaling-stroke"
      />
      {/* Every real reading gets a dot, so you can see how much of the line is
          measured and how much is interpolation between distant points. */}
      {points.map((p) => (
        <circle
          key={p.on}
          cx={x(p.on)}
          cy={y(p.value)}
          r={1.6}
          className="fill-ink-3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <circle cx={x(last.on)} cy={y(last.value)} r={2.6} className="fill-accent" />
    </svg>
  )
}
