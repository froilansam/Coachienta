import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

/** In-button loading and indeterminate waits only. Content uses Skeleton. */
export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} aria-hidden className={cn('animate-spin text-ink-3', className)} />
}
