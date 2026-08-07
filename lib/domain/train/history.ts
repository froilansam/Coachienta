import type { SessionSummaryRow } from '@/lib/db/queries/plan'

/**
 * The session history list: grouping, one-line summaries, and the words a delete
 * confirmation uses.
 *
 * Pure. The whole reason this is not inline in the component is the delete copy —
 * it has to state the exact number of sets that will disappear, and a sentence that
 * decides whether something irreversible happens deserves a test.
 */
export interface SessionRow extends SessionSummaryRow {
  /** `4,180 kg · 14 sets · 42m` — only the parts that are real. */
  line: string
  isLive: boolean
}

export interface DateGroup {
  on: string
  /** `THU 6 AUG`, or `TODAY` / `YESTERDAY`. */
  label: string
  rows: SessionRow[]
}

const minutesBetween = (from: string | null, to: string | null): number | null => {
  if (from === null || to === null) return null
  const mins = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000)
  return mins > 0 ? mins : null
}

export const durationLabel = (mins: number): string =>
  mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`

/**
 * Only what happened. A session with no sets says so rather than showing `0 kg`,
 * and a session with no `started_at` — every row imported from the spreadsheet —
 * simply omits the duration instead of inventing one.
 */
export function summarise(s: SessionSummaryRow): string {
  if (s.set_count === 0) return 'nothing logged'
  const mins = minutesBetween(s.started_at, s.completed_at)
  return [
    s.volume_kg > 0 ? `${s.volume_kg.toLocaleString()} kg` : null,
    `${s.set_count} set${s.set_count === 1 ? '' : 's'}`,
    mins === null ? null : durationLabel(mins),
    s.pr_count > 0 ? `${s.pr_count} PR` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function decorate(s: SessionSummaryRow): SessionRow {
  return { ...s, line: summarise(s), isLive: s.completed_at === null }
}

/**
 * Newest day first, sessions within a day kept in the order the query returned.
 *
 * Two sessions on one calendar day are two rows, never merged — the spreadsheet had
 * duplicate-date rows that double-counted, and §6 makes the separation explicit.
 */
export function groupByDate(sessions: readonly SessionSummaryRow[], today: string): DateGroup[] {
  const out: DateGroup[] = []
  for (const s of sessions) {
    const found = out.find((g) => g.on === s.performed_on)
    const row = decorate(s)
    if (found) found.rows.push(row)
    else out.push({ on: s.performed_on, label: dayLabel(s.performed_on, today), rows: [row] })
  }
  return out
}

export function dayLabel(iso: string, today: string): string {
  if (iso === today) return 'TODAY'
  const yesterday = new Date(`${today}T00:00:00`)
  yesterday.setDate(yesterday.getDate() - 1)
  const y = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
  if (iso === y) return 'YESTERDAY'
  return new Date(`${iso}T00:00:00`)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    .toUpperCase()
}

/**
 * `Delete Leg Day · 6 Aug? 14 sets will be removed. This cannot be undone.`
 *
 * The set count is not decoration — it is the only warning you get, because the
 * cloud is the truth and there is no undo after confirm (§6). An in-progress session
 * says so, since deleting one is abandoning it rather than cleaning up history.
 */
export function deleteCopy(s: SessionRow): string {
  const when = new Date(`${s.performed_on}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
  const what = s.isLive
    ? `${s.name ?? 'this session'} · ${when} · in progress`
    : `${s.name ?? 'this session'} · ${when}`
  const sets =
    s.set_count === 0
      ? 'It has no sets logged.'
      : `${s.set_count} set${s.set_count === 1 ? '' : 's'} will be removed.`
  return `Delete ${what}? ${sets} This cannot be undone.`
}
