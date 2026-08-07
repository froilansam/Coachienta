import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Layout from the scale only. Exists so nobody reaches for an ad-hoc margin.
 * More space AROUND a group than WITHIN it — that single ratio is what makes a
 * dense screen legible rather than cramped (`arrange`).
 */
const GAP = { 0: 'gap-0', 1: 'gap-1', 2: 'gap-2', 3: 'gap-3', 4: 'gap-4', 6: 'gap-6', 8: 'gap-8', 12: 'gap-12' } as const
export type Gap = keyof typeof GAP

interface Props {
  gap?: Gap
  className?: string
  children: ReactNode
}

export const Stack = ({ gap = 3, className, children }: Props) => (
  <div className={cn('flex flex-col', GAP[gap], className)}>{children}</div>
)

export const Row = ({
  gap = 2,
  align = 'center',
  className,
  children,
}: Props & { align?: 'start' | 'center' | 'end' | 'baseline' }) => (
  <div className={cn('flex', GAP[gap], `items-${align}`, className)}>{children}</div>
)

/** Section: label + generous space above, so groups read as groups. */
export const Section = ({ className, children }: { className?: string; children: ReactNode }) => (
  <section className={cn('flex flex-col gap-3', className)}>{children}</section>
)
