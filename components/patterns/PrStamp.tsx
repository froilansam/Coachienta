'use client'
import { Flame, TrendingUp } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'

/**
 * Delight, read for the room: a mechanical press coming down, not confetti.
 * Scale 1.06 → 1.0 with a 1px rotation settle (PRD-002 §10).
 *
 * Two ranks, because a record is judged per set position now and four of them can
 * land in one session. `PR` is the best of any set; `SET PR` is the best this
 * position has produced — a smaller and truer claim, and it has to LOOK smaller or
 * the word goes the way of the spreadsheet's `PR Flag` column, which marked
 * everything and meant nothing.
 *
 * The union is declared here rather than imported: Tier 1 takes display props and
 * holds no domain knowledge. It matches `PrScope` structurally.
 *
 * `key={stampKey}` remounts so the animation replays on each new PR rather than
 * firing once and never again.
 */
export type PrStampScope = 'all_time' | 'set'

export function PrStamp({
  scope = 'all_time',
  stampKey,
}: {
  scope?: PrStampScope
  stampKey?: string | number
}) {
  const allTime = scope === 'all_time'
  return (
    <span key={stampKey} className="inline-block animate-stamp motion-reduce:animate-none">
      <Chip
        label={allTime ? 'PR' : 'SET PR'}
        tone={allTime ? 'accent' : 'pos'}
        icon={allTime ? Flame : TrendingUp}
      />
    </span>
  )
}
