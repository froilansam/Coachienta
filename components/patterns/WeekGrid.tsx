import { Check } from 'lucide-react'
import { Text } from '@/components/ui/Text'
import { cn } from '@/lib/cn'

/**
 * A week per row, seven cells across — the GitHub contribution grid, rotated so it
 * fits a phone.
 *
 * The reason this beats a bar of weekly counts: four sessions crammed into a weekend
 * and four spread through the week are the same number and not the same week. A grid
 * shows the shape; a count hides it.
 *
 * Days beyond today are `filler` — drawn as nothing at all rather than as a miss,
 * because the current week has not failed yet.
 */
export interface GridCell {
  key: string
  count: number
  /** Hover text and accessible name. `null` cells are outside the range. */
  label: string | null
  filler: boolean
}

export interface GridRow {
  key: string
  label: string
  cells: readonly GridCell[]
  /** Reached the target — the row gets a tick, not a colour change. */
  met: boolean
  count: number
}

export function WeekGrid({
  rows,
  columnLabels,
  target,
}: {
  rows: readonly GridRow[]
  columnLabels: readonly string[]
  target: number
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3 pl-14">
        <div className="grid flex-1 grid-cols-7 gap-1">
          {columnLabels.map((c, i) => (
            <Text key={`${c}-${i}`} variant="micro" tone="tertiary" className="text-center">
              {c}
            </Text>
          ))}
        </div>
        <span className="w-8" />
      </div>

      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-3">
            <Text variant="label" className="w-11 shrink-0">
              {row.label}
            </Text>
            <div className="grid flex-1 grid-cols-7 gap-1">
              {row.cells.map((cell) => (
                <span
                  key={cell.key}
                  title={cell.label ?? undefined}
                  aria-label={cell.label ?? undefined}
                  className={cn(
                    'h-5 rounded-[2px] border',
                    cell.filler
                      ? 'border-transparent'
                      : cell.count === 0
                        ? 'border-rule bg-sunk'
                        : cell.count === 1
                          ? 'border-accent/40 bg-accent/55'
                          : // Two sessions in a day is allowed and worth seeing.
                            'border-accent bg-accent',
                  )}
                />
              ))}
            </div>
            <span className="flex w-8 shrink-0 items-center justify-end gap-1">
              <Text variant="micro" tone={row.met ? 'accent' : 'tertiary'}>
                {String(row.count)}
              </Text>
              {row.met ? (
                <Check size={11} strokeWidth={2.5} aria-label={`met the ${target} session target`} className="text-accent-ink" />
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
