'use client'
import { Trash2 } from 'lucide-react'
import Link from 'next/link'
import { Chip } from '@/components/ui/Chip'
import { Rule } from '@/components/ui/Rule'
import { Text } from '@/components/ui/Text'
import type { DateGroup, SessionRow } from '@/lib/domain/train/history'

/**
 * Sessions grouped by the day they happened (AC-2.21).
 *
 * A date heading with its rows beneath, not a card per session — the same
 * Rule-separated group the food day list uses, so history reads the same way on both
 * halves of the app.
 *
 * Delete is a visible 44 px button rather than a `⋯` menu. There is one action here;
 * hiding it behind a menu costs a tap and gains nothing, and the confirm step is
 * where the safety actually lives.
 *
 * **No chevron.** It sat inside the link, so it stopped 44 px short of the delete
 * button and disagreed with the flush-right chevrons of the navigation list directly
 * above — two lists on one screen with two different trailing edges. Dropping it makes
 * the delete button the right edge, which lines up, and loses nothing: the whole row
 * is already a link.
 */
export function SessionList({
  groups,
  onDelete,
}: {
  groups: readonly DateGroup[]
  onDelete: (row: SessionRow) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.on} className="flex flex-col gap-1">
          <Text as="h3" variant="label">
            {group.label}
          </Text>
          <Rule />
          <ul className="flex flex-col">
            {group.rows.map((row) => (
              <li key={row.id} className="flex items-center border-b border-rule last:border-0">
                <Link
                  href={`/train/session/${row.id}`}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 pr-2"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      <Text variant="body" truncate>
                        {row.name ?? 'Untitled session'}
                      </Text>
                      {/* Tapping a live session resumes it; tapping a finished one
                          opens it to correct a set. Same screen either way. */}
                      {row.isLive ? <Chip label="LIVE" tone="accent" size="sm" /> : null}
                    </span>
                    <Text variant="micro">
                      {[row.gym_name ?? 'No gym', row.line].filter(Boolean).join(' · ')}
                    </Text>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => onDelete(row)}
                  aria-label={`Delete ${row.name ?? 'session'} on ${group.label}`}
                  className="grid size-11 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-neg-wash hover:text-neg"
                >
                  <Trash2 size={16} strokeWidth={1.5} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
