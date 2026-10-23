import { Panel } from '@/components/patterns/Panel'
import { Text } from '@/components/ui/Text'
import type { ReportLine } from '@/lib/domain/food/report'

/**
 * The food report. Every number arrives already worded — this file only places it.
 */
export function FoodReport({ lines }: { lines: readonly ReportLine[] }) {
  return (
    <Panel
      title="Report"
      caption="Finished weeks only, per logged day. TDEE is what you ate, adjusted for the weight change over those same weeks."
    >
      <ul className="flex flex-col gap-4">
        {lines.map((line) => (
          <li key={line.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <Text variant="label">{line.label}</Text>
              <Text variant="body" tone={line.tone} className="text-right tabular">
                {line.value}
              </Text>
            </div>
            <Text variant="meta" tone="secondary">
              {line.detail}
            </Text>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
