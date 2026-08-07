import { cn } from '@/lib/cn'

const TONE = {
  accent: 'bg-accent',
  pos: 'bg-pos',
  warn: 'bg-warn',
  neg: 'bg-neg',
} as const

/**
 * Segmented blocky fill — the Instrument treatment, not a smooth rounded bar.
 *
 * `overflow` matters for calories: 110% of target must LOOK different from
 * 100%, not silently clamp to a full bar.
 */
export function ProgressTrack({
  pct,
  tone = 'accent',
  size = 'md',
  label,
  segments = 20,
}: {
  pct: number
  tone?: keyof typeof TONE
  size?: 'sm' | 'md'
  label: string
  segments?: number
}) {
  const clamped = Math.max(0, Math.min(pct, 100))
  const filled = Math.round((clamped / 100) * segments)
  const over = pct > 100

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('flex w-full gap-px', size === 'sm' ? 'h-1.5' : 'h-2.5')}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={cn(
            'flex-1 rounded-[1px] transition-colors duration-150',
            i < filled ? TONE[tone] : 'bg-sunk',
          )}
        />
      ))}
      {over ? <span className={cn('w-1 rounded-[1px]', TONE.neg)} aria-hidden /> : null}
    </div>
  )
}
