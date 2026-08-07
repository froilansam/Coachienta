'use client'
import { Button } from '@/components/ui/Button'
import { formatDuration } from '@/lib/domain/train/session'

/**
 * The rest countdown, pinned above the tab bar.
 *
 * A bottom overlay with `−15 / +15 / SKIP` replaced my original "haptic + row
 * pulse": mid-set you need to read the number and adjust it, not feel a buzz
 * (PRD-002 §0, Hevy). It starts automatically on a commit (US-2.10) — one less tap
 * in the only moment when both hands are busy.
 */
export function RestOverlay({
  remaining,
  onAdjust,
  onSkip,
}: {
  remaining: number
  onAdjust: (delta: number) => void
  onSkip: () => void
}) {
  return (
    <div
      role="timer"
      aria-live="off"
      aria-label={`Rest, ${remaining} seconds remaining`}
      className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)+0.5rem)] z-40 mx-auto flex w-[min(100%-2rem,32rem)] items-center justify-between gap-3 rounded-md border border-rule-strong bg-surface px-3 py-2 shadow-lg"
    >
      <span className="tabular font-mono text-xl text-ink">{formatDuration(remaining * 1000)}</span>
      <span className="flex items-center gap-1.5">
        <Button variant="secondary" size="sm" onClick={() => onAdjust(-15)}>−15</Button>
        <Button variant="secondary" size="sm" onClick={() => onAdjust(15)}>+15</Button>
        <Button variant="ghost" size="sm" onClick={onSkip}>SKIP</Button>
      </span>
    </div>
  )
}
