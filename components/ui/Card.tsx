import type { ElementType, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Deliberately constrained. Only for a genuinely DETACHABLE object — a session,
 * a chat message, a food candidate.
 *
 * Never nest a Card in a Card, and never build a uniform grid of identical
 * tiles: that is the recognisable fingerprint of generated design. Default
 * container in this app is a Rule-separated group (`arrange`).
 */
const PAD = { none: '', sm: 'p-3', md: 'p-4' } as const

export function Card({
  as: Tag = 'div',
  padding = 'md',
  interactive = false,
  className,
  children,
}: {
  as?: ElementType
  padding?: keyof typeof PAD
  interactive?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <Tag
      className={cn(
        'rounded-md border border-rule bg-surface',
        PAD[padding],
        interactive && 'transition-colors hover:border-rule-strong active:bg-sunk',
        className,
      )}
    >
      {children}
    </Tag>
  )
}
