import { Panel } from '@/components/patterns/Panel'
import { Chip } from '@/components/ui/Chip'
import { NumericValue } from '@/components/ui/NumericValue'
import { Text } from '@/components/ui/Text'
import type { AdherenceRow } from '@/lib/domain/train/trends'

/**
 * Priority order against where the volume actually went.
 *
 * PRD-004 §4.4 calls this "the one the spreadsheet couldn't produce and the one most
 * likely to change behaviour", so it sits FIRST on the screen. Everything else here
 * describes what happened; this one answers a question you asked.
 *
 * The verdict is a word, not a colour alone — `under` on a 5-item list means the
 * group drifted two or more places from where you ranked it.
 */
const TONE = { on: 'neutral', under: 'warn', over: 'accent' } as const
const VERDICT = { on: 'ON ORDER', under: 'UNDER', over: 'OVER' } as const

export function AdherencePanel({ rows, note }: { rows: readonly AdherenceRow[]; note: string | null }) {
  return (
    <Panel
      title="Priority adherence"
      caption="Share of the last 30 days' volume, against the order you ranked. Adjust the order in Profile → Physique priorities."
      footer={
        note ? (
          <Text variant="meta" tone={rows.some((r) => r.verdict === 'under') ? 'warn' : 'secondary'}>
            {note}
          </Text>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <Text variant="micro">No priorities set, so there is nothing to compare volume against.</Text>
      ) : (
        <ul className="flex flex-col">
          {rows.map((r) => (
            <li
              key={r.label}
              className="flex min-h-9 items-center gap-3 border-b border-rule py-1.5 last:border-0"
            >
              <Text variant="micro" tone="tertiary" className="w-4 shrink-0 text-right">
                {String(r.rank)}
              </Text>
              <Text variant="meta" className="min-w-0 flex-1" truncate>
                {r.label}
              </Text>
              {/*
                A bar rather than only a percentage: five numbers in a column are read
                one at a time, five bars are compared at a glance. It was `hidden
                sm:block`, which meant it never appeared on the 390 px phone this app
                is designed for — so it is narrower instead of absent.
              */}
              <span aria-hidden className="block h-1.5 w-12 shrink-0 rounded-[1px] bg-sunk">
                <span
                  className="block h-full rounded-[1px] bg-ink/45"
                  style={{ width: `${Math.min(100, r.sharePct)}%` }}
                />
              </span>
              {/* Fixed and right-aligned, or `9%` and `41%` put their `%` at
                  different x down a five-row column. */}
              <span className="w-9 shrink-0 text-right">
                <NumericValue value={r.sharePct} unit="%" decimals={0} size="compact" tone="secondary" />
              </span>
              <span className="w-16 shrink-0 text-right">
                <Chip label={VERDICT[r.verdict]} tone={TONE[r.verdict]} size="sm" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
