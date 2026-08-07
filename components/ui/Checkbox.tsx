'use client'
import * as RC from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Two roles. `default` is an ordinary checkbox; `commit` is the set-complete
 * control in the live workout table — 32px, thumb-sized, always in the same
 * column so sets can be ticked out of order.
 *
 * Hevy and Gymshark both landed on a checkbox column rather than a per-row Save
 * button. Smaller, fixed position, order-independent (PRD-002 §0).
 */
export function Checkbox({
  checked,
  onCheckedChange,
  label,
  variant = 'default',
  disabled,
}: {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  label: string
  variant?: 'default' | 'commit'
  disabled?: boolean
}) {
  const big = variant === 'commit'
  return (
    <RC.Root
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'grid shrink-0 place-items-center rounded-sm border transition-colors',
        big ? 'size-8' : 'size-5',
        checked ? 'border-accent bg-accent text-on-accent' : 'border-rule-strong bg-surface',
        'disabled:opacity-40',
      )}
    >
      <RC.Indicator>
        <Check size={big ? 20 : 14} strokeWidth={3} aria-hidden />
      </RC.Indicator>
    </RC.Root>
  )
}
