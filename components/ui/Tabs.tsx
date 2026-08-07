'use client'
import * as RT from '@radix-ui/react-tabs'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Underline indicator, never pills — pills are SegmentedControl's job, and
 * having two pill-shaped switchers on one screen makes neither mean anything.
 *
 * Cross-fade on change, no slide (PRD-002 §6).
 */
export interface TabsProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: ReadonlyArray<{ value: T; label: string }>
  label: string
  children: ReactNode
}

export function Tabs<T extends string>({ value, onChange, options, label, children }: TabsProps<T>) {
  return (
    <RT.Root value={value} onValueChange={(v) => onChange(v as T)} className="flex flex-col gap-3">
      <RT.List aria-label={label} className="flex gap-1 border-b border-rule">
        {options.map((o) => (
          <RT.Trigger
            key={o.value}
            value={o.value}
            className={cn(
              'relative -mb-px min-h-11 px-3 text-base font-medium transition-colors',
              'text-ink-3 hover:text-ink-2',
              'data-[state=active]:text-ink',
              'after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-transparent',
              'data-[state=active]:after:bg-accent',
            )}
          >
            {o.label}
          </RT.Trigger>
        ))}
      </RT.List>
      {children}
    </RT.Root>
  )
}

export const TabPanel = ({ value, children }: { value: string; children: ReactNode }) => (
  <RT.Content value={value} className="animate-fade-in outline-none">
    {children}
  </RT.Content>
)
