'use client'
import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Text } from '@/components/ui/Text'

/**
 * `OFFLINE · 3 PENDING`
 *
 * Always visible in the header. This is the antidote to the spreadsheet's
 * orphaned-tab problem: unsynced work is never silently invisible, and a failed
 * mutation surfaces as a number rather than disappearing (PRD-001 §4.2).
 *
 * Persistent and quiet — never a blocking modal (PRD-002 §9).
 */
export interface SyncBadgeProps {
  online: boolean
  pending: number
  failed: number
  onRetry?: () => void
}

export function SyncBadge({ online, pending, failed, onRetry }: SyncBadgeProps) {
  // Fully synced and online is the normal case — say nothing.
  if (online && pending === 0 && failed === 0) return null

  const tone = failed > 0 ? 'neg' : !online ? 'warn' : 'neutral'
  const Icon = failed > 0 ? TriangleAlert : !online ? CloudOff : RefreshCw

  const parts = [
    !online && 'OFFLINE',
    pending > 0 && `${pending} PENDING`,
    failed > 0 && `${failed} FAILED`,
  ].filter(Boolean)

  const Tag = failed > 0 && onRetry ? 'button' : 'div'

  return (
    <Tag
      {...(failed > 0 && onRetry ? { type: 'button' as const, onClick: onRetry } : {})}
      // role=status so it's announced without stealing focus
      role="status"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm px-1.5 py-1',
        tone === 'neg' && 'bg-neg-wash',
        tone === 'warn' && 'bg-warn-wash',
        tone === 'neutral' && 'bg-sunk',
      )}
    >
      <Icon
        size={12}
        strokeWidth={2}
        aria-hidden
        className={cn(
          tone === 'neg' ? 'text-neg' : tone === 'warn' ? 'text-warn' : 'text-ink-3',
          tone === 'neutral' && pending > 0 && 'animate-spin',
        )}
      />
      <Text variant="label" tone={tone === 'neutral' ? 'tertiary' : tone}>
        {parts.join(' · ')}
      </Text>
      {failed > 0 && onRetry ? (
        <Text variant="label" tone="neg" className="underline underline-offset-2">
          RETRY
        </Text>
      ) : null}
    </Tag>
  )
}
