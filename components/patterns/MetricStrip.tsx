import { NumericValue } from '@/components/ui/NumericValue'
import { Text } from '@/components/ui/Text'

/**
 * `DURATION 42:18   VOLUME 4,180 kg   SETS 14`
 *
 * Straight from Hevy, which pins this to the top of a live session. Nearly free
 * to build and it makes a session feel measured while you're in it — a gap in
 * my original PRD-004 (PRD-002 §0).
 */
export interface Metric {
  label: string
  value: number | null
  unit?: string
  /** Pre-formatted display (e.g. "42:18"). Overrides value rendering. */
  display?: string
}

export function MetricStrip({ metrics }: { metrics: readonly Metric[] }) {
  return (
    <dl className="flex items-baseline gap-6">
      {metrics.map((m) => (
        <div key={m.label} className="flex items-baseline gap-1.5">
          <dt>
            <Text variant="label">{m.label}</Text>
          </dt>
          <dd>
            {m.display ? (
              <span className="tabular font-mono text-base">{m.display}</span>
            ) : (
              <NumericValue value={m.value} unit={m.unit} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}
