'use client'
import { Flame } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'

/**
 * Delight, read for the room: a mechanical press coming down, not confetti.
 * Scale 1.06 → 1.0 with a 1px rotation settle (PRD-002 §10).
 *
 * `key={stampKey}` remounts so the animation replays on each new PR rather than
 * firing once and never again.
 */
export function PrStamp({ stampKey }: { stampKey?: string | number }) {
  return (
    <span key={stampKey} className="inline-block animate-stamp motion-reduce:animate-none">
      <Chip label="PR" tone="accent" icon={Flame} />
    </span>
  )
}
