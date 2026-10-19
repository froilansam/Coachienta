'use client'
import { Chip } from '@/components/ui/Chip'
import { Button } from '@/components/ui/Button'
import { Text } from '@/components/ui/Text'
import type { SessionReview as Review } from '@/lib/domain/train/review'

/**
 * The coach's read of a finished session, sitting on the session itself.
 *
 * A record on the first exercise and the same record third are not the same
 * thing, and that judgment is what this card is for. The sentences come from
 * the model; the card only places them.
 */
const VERDICT = {
  progress: { label: 'Progress', tone: 'pos' },
  mixed: { label: 'Mixed', tone: 'warn' },
  flat: { label: 'No progress', tone: 'neg' },
} as const

export function SessionReviewCard({
  status,
  review,
  error,
  onRetry,
}: {
  status: 'hidden' | 'empty' | 'loading' | 'ready' | 'error'
  review: Review | null
  error: string | null
  onRetry: () => void
}) {
  if (status === 'hidden') return null

  return (
    <section className="flex flex-col gap-2 rounded-md bg-sunk px-3 py-3">
      <Text variant="label">COACH</Text>
      {status === 'loading' ? (
        <Text variant="meta">Reading this session…</Text>
      ) : null}
      {status === 'empty' ? (
        <Text variant="meta">Nothing was logged, so there is nothing to read.</Text>
      ) : null}
      {status === 'error' ? (
        <>
          <Text variant="meta">{error ?? 'The coach could not read this session.'}</Text>
          <Button variant="secondary" onClick={onRetry}>
            TRY AGAIN
          </Button>
        </>
      ) : null}
      {status === 'ready' && review ? (
        <>
          <span className="flex items-center gap-2">
            <Chip label={VERDICT[review.verdict].label} tone={VERDICT[review.verdict].tone} />
          </span>
          <Text variant="body">{review.headline}</Text>
          <Text variant="meta">{review.read}</Text>
          <ul className="flex flex-col gap-1">
            {review.recommendations.map((line) => (
              <li key={line}>
                <Text variant="micro">{line}</Text>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
