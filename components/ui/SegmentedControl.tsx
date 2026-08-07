'use client'
import { cn } from '@/lib/cn'

/**
 * View switching: Gym/Rest day, 7d/30d/90d, and the
 * `Serving / 100 g / 100 ml` basis toggle that MacroFactor and Cal AI both ship
 * — which maps 1:1 onto our `basis_unit` enum (PRD-002 §0).
 */
export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>
  value: T
  onChange: (v: T) => void
  label: string
  size?: 'sm' | 'md'
  fullWidth?: boolean
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  fullWidth,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex rounded-md border border-rule bg-sunk p-0.5',
        fullWidth && 'w-full',
      )}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-[3px] font-medium transition-colors disabled:opacity-40',
              fullWidth && 'flex-1',
              size === 'sm' ? 'h-7 px-2.5 text-sm' : 'h-9 px-3.5 text-base',
              active ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
