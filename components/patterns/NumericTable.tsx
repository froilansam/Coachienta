'use client'
import type { ReactNode } from 'react'
import { Text } from '@/components/ui/Text'
import { cn } from '@/lib/cn'

/**
 * The live-workout set table, and any dense numeric grid.
 *
 * A real <table> with <th scope="col"> — not divs. Screen readers announce
 * "row 3, KG 10, REPS 13" only if the semantics are real (PRD-002 §11).
 *
 * `committed` fills the row. Hevy turns it green, Gymshark fills it with their
 * accent; my original spec said "1px inset shadow", which is far too subtle to
 * read at a glance while you're breathing hard between sets (PRD-002 §0).
 *
 * Cells carry their own horizontal padding, flush at the outer edges. Without it
 * adjacent columns touched: the header read `SETPREV` and `REPS✓` as single words, and
 * a committed row put its reps value hard against the checkbox. `first:pl-0 last:pr-0`
 * keeps the table's edges aligned with the rest of the screen.
 */
export type RowState = 'default' | 'committed' | 'active' | 'disabled'

export interface Column<Row> {
  key: string
  header: string
  align?: 'start' | 'end'
  /** `min` shrinks to content — use for the checkbox and set-index columns. */
  width?: 'auto' | 'min'
  render: (row: Row) => ReactNode
}

export interface NumericTableProps<Row> {
  caption: string
  columns: ReadonlyArray<Column<Row>>
  rows: readonly Row[]
  rowKey: (row: Row) => string
  rowState?: (row: Row) => RowState
  /** Rows that just committed, so the flash plays once rather than on rerender. */
  flashKeys?: ReadonlySet<string>
  zebra?: boolean
}

const ROW_STATE: Record<RowState, string> = {
  default: '',
  committed: 'bg-accent-wash/60',
  active: 'bg-sunk',
  disabled: 'opacity-40',
}

export function NumericTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  rowState,
  flashKeys,
  zebra,
}: NumericTableProps<Row>) {
  return (
    <table className="w-full border-collapse">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-rule">
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              className={cn(
                'px-1.5 pb-1.5 font-normal first:pl-0 last:pr-0',
                c.align === 'end' ? 'text-right' : 'text-left',
                c.width === 'min' && 'w-px whitespace-nowrap',
              )}
            >
              <Text variant="label">{c.header}</Text>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const key = rowKey(row)
          const state = rowState?.(row) ?? 'default'
          return (
            <tr
              key={key}
              className={cn(
                'border-b border-rule last:border-0',
                zebra && i % 2 === 1 && 'bg-sunk/50',
                ROW_STATE[state],
                flashKeys?.has(key) && 'animate-commit',
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'px-1.5 py-1.5 align-middle first:pl-0 last:pr-0',
                    c.align === 'end' ? 'text-right' : 'text-left',
                    c.width === 'min' && 'w-px whitespace-nowrap',
                  )}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
