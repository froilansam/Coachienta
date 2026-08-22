import { NumericValue } from '@/components/ui/NumericValue'
import { Text } from '@/components/ui/Text'
import { cn } from '@/lib/cn'

/**
 * Several lines on one date axis. `TrendChart` draws exactly one series and takes a
 * body-measurement `Series`; this takes any number and knows nothing about what it
 * plots — which is what lets one exercise show a separate line per gym.
 *
 * Same drawing rules as `TrendChart`: hairline stroke, no fill, no gradient, a dot
 * on every real reading, and points placed by DATE so a three-week gap looks like a
 * three-week gap (PRD-002 §0).
 *
 * Lines are NOT joined across series. Two gyms are two lines with a visible break
 * between them, because a 45 kg cable stack at one gym is not 45 kg at another —
 * bridging them would draw a step change in strength that never happened.
 */
export interface LinePoint {
  on: string
  value: number
  label: string
}
export interface Line {
  key: string
  label: string
  points: readonly LinePoint[]
}

/** A vertical hairline on the date axis — e.g. the day a gym line begins. */
export interface AxisMarker {
  on: string
  label: string
}

const W = 320
const H = 84
const PAD = 4

/** First series is accent; the rest fall back to ink so they stay legible. */
const STROKE = ['text-accent', 'text-ink-2', 'text-ink-3'] as const
const strokeOf = (i: number): string => STROKE[i % STROKE.length]!

const ms = (on: string): number => new Date(`${on}T00:00:00`).getTime()

export function LineSet({
  lines,
  unit,
  decimals = 1,
  /** Assisted work improves DOWNWARD; the caption has to say so or the chart lies. */
  betterIsDown = false,
  emptyLabel = 'Not enough history to draw a line.',
  markers = [],
}: {
  lines: readonly Line[]
  unit: string
  decimals?: number
  betterIsDown?: boolean
  emptyLabel?: string
  markers?: readonly AxisMarker[]
}) {
  const all = lines.flatMap((l) => [...l.points])
  if (all.length === 0) return <Text variant="micro">{emptyLabel}</Text>

  const values = all.map((p) => p.value)
  const times = all.map((p) => ms(p.on))
  const min = Math.min(...values)
  const max = Math.max(...values)
  const t0 = Math.min(...times)
  const t1 = Math.max(...times)

  const span = max - min || Math.max(max * 0.02, 1)
  const lo = min - span * 0.15
  const hi = max + span * 0.15
  const width = t1 - t0

  const x = (on: string) => (width === 0 ? W / 2 : PAD + ((ms(on) - t0) / width) * (W - PAD * 2))
  const y = (v: number) => H - PAD - ((v - lo) / (hi - lo)) * (H - PAD * 2)

  const first = all.reduce((a, b) => (ms(a.on) <= ms(b.on) ? a : b))
  const last = all.reduce((a, b) => (ms(a.on) >= ms(b.on) ? a : b))
  const direction = betterIsDown ? 'lower is better' : 'higher is better'

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-21 w-full overflow-visible"
        role="img"
        aria-label={`${lines.length} series, ${all.length} readings from ${first.label} on ${first.on} to ${last.label} on ${last.on}. ${unit}, ${direction}.`}
      >
        {markers.map((m) => (
          <g key={`${m.on}-${m.label}`}>
            <line
              x1={x(m.on)}
              x2={x(m.on)}
              y1={PAD}
              y2={H - PAD}
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="2 3"
              className="text-ink-3"
              vectorEffect="non-scaling-stroke"
            />
            <title>{`${m.label} from ${m.on}`}</title>
          </g>
        ))}
        {lines.map((line, i) => {
          const pts = [...line.points].sort((a, b) => a.on.localeCompare(b.on))
          if (pts.length === 0) return null
          const path = pts.map((p) => `${x(p.on).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
          return (
            <g key={line.key} className={strokeOf(i)}>
              {/* A single reading has no line to draw — the dot alone is the truth. */}
              {pts.length > 1 ? (
                <polyline
                  points={path}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
              {pts.map((p) => (
                <circle key={p.on} cx={x(p.on)} cy={y(p.value)} r={1.8} fill="currentColor" />
              ))}
            </g>
          )
        })}
      </svg>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <ul className="flex flex-wrap gap-3">
          {lines.map((line, i) => (
            <li key={line.key} className="flex items-center gap-1.5">
              <span aria-hidden className={cn(strokeOf(i), 'h-px w-3 bg-current')} />
              <Text variant="micro" tone="secondary">
                {line.label}
              </Text>
            </li>
          ))}
          {markers.map((m) => (
            <li key={`m-${m.on}-${m.label}`}>
              <Text variant="micro" tone="tertiary">
                {`┊ ${m.label}`}
              </Text>
            </li>
          ))}
        </ul>
        <div className="flex items-baseline gap-1.5">
          <Text variant="label">{betterIsDown ? 'LOWEST' : 'BEST'}</Text>
          <NumericValue
            value={betterIsDown ? min : max}
            unit={unit}
            decimals={decimals}
            size="compact"
          />
        </div>
      </div>
    </div>
  )
}
