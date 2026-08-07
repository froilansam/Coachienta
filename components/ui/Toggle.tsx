'use client'
import * as RS from '@radix-ui/react-switch'
import { cn } from '@/lib/cn'
import { Text } from './Text'

/**
 * A persistent setting — not a filter and not a view switch. Use
 * SegmentedControl for switching views, Chip for filters.
 *
 * The label is part of the hit area, so tapping the text toggles it.
 */
export function Toggle({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
      <span className="flex flex-col gap-0.5">
        <Text variant="body">{label}</Text>
        {hint ? <Text variant="micro">{hint}</Text> : null}
      </span>
      <RS.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className={cn(
          'relative h-6.5 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-40',
          checked ? 'border-accent bg-accent' : 'border-rule-strong bg-sunk',
        )}
      >
        <RS.Thumb
          className={cn(
            'block size-5 rounded-full bg-surface shadow-sm',
            'transition-transform duration-150 ease-out-quart',
            'translate-x-0.5 data-[state=checked]:translate-x-5.5',
          )}
        />
      </RS.Root>
    </label>
  )
}
