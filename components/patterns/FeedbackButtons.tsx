'use client'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { useState } from 'react'
import { Text } from '@/components/ui/Text'
import { cn } from '@/lib/cn'

/**
 * 👍 / 👎 on an AI output — Cal AI's "How did Cal AI do?".
 *
 * A real quality signal on the vision route, which is otherwise unmeasurable:
 * we have no ground truth for what was actually on the plate.
 */
export function FeedbackButtons({
  prompt = 'How did that read?',
  onRate,
}: {
  prompt?: string
  onRate?: (rating: 'up' | 'down') => void
}) {
  const [rated, setRated] = useState<'up' | 'down' | null>(null)

  const rate = (r: 'up' | 'down') => {
    setRated(r)
    onRate?.(r)
  }

  return (
    <div className="flex items-center gap-2">
      <Text variant="micro">{rated ? 'Thanks — noted.' : prompt}</Text>
      {(['up', 'down'] as const).map((r) => {
        const Icon = r === 'up' ? ThumbsUp : ThumbsDown
        return (
          <button
            key={r}
            type="button"
            aria-label={r === 'up' ? 'Good reading' : 'Poor reading'}
            aria-pressed={rated === r}
            onClick={() => rate(r)}
            className={cn(
              'grid size-8 place-items-center rounded-md border transition-colors',
              rated === r ? 'border-accent bg-accent-wash text-accent-ink' : 'border-rule text-ink-3 hover:bg-sunk',
            )}
          >
            <Icon size={14} strokeWidth={1.75} aria-hidden />
          </button>
        )
      })}
    </div>
  )
}
