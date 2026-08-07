import { cn } from '@/lib/cn'

/**
 * The structural primitive. Replaces cards as the default container —
 * less wasted space, and it avoids the rounded-box-with-shadow look that
 * reads as generic (PRD-002 §3.3).
 *
 * If a rule looks too faint, make it THICKER, not darker.
 */
export function Rule({ strong, inset }: { strong?: boolean; inset?: boolean }) {
  return (
    <hr
      className={cn(
        'border-0 border-b',
        strong ? 'border-rule-strong' : 'border-rule',
        inset && 'ml-4',
      )}
    />
  )
}
