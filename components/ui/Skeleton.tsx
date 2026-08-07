import { cn } from '@/lib/cn'

/**
 * Shape matches the final content. NEVER a spinner for content — a spinner says
 * "something is happening"; a skeleton says "a list of rows is coming", which
 * stops the layout jumping when it arrives (`polish`).
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('block animate-[pulse-track_1.4s_ease-in-out_infinite] rounded-sm bg-sunk', className)}
    />
  )
}

/** Placeholder matching a ListRow: title, subtitle, right-aligned number. */
export function SkeletonRow() {
  return (
    <div className="flex min-h-11 items-center gap-3 py-2">
      <span className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3 w-1/4" />
      </span>
      <Skeleton className="h-4 w-10" />
    </div>
  )
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  )
}
