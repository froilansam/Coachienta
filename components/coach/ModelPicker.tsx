'use client'
import { Sheet } from '@/components/ui/Sheet'
import { Text } from '@/components/ui/Text'
import { cn } from '@/lib/cn'
import {
  describeQuota,
  percentUsed,
  quotaState,
  type ModelChoice,
  type ModelOption,
} from '@/lib/domain/coach/models'

/**
 * Choosing which model answers — which is really choosing **which quota to spend**
 * (US-3.7).
 *
 * The figures are the feature, not decoration. The reason to switch is that one pool is
 * nearly gone, and without the numbers that is invisible until a reply fails. So each
 * option shows what it has left, and a spent one is disabled rather than hidden — an
 * option that vanishes looks like a bug, and you need to see that it will be back tomorrow.
 */
const STATE_TONE = {
  ok: 'text-ink-3',
  low: 'text-warn',
  spent: 'text-neg',
} as const

export function ModelPicker({
  open,
  onOpenChange,
  options,
  selected,
  onSelect,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  options: readonly ModelOption[]
  selected: ModelChoice
  onSelect: (choice: ModelChoice) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Model">
      <div className="flex flex-col gap-1 pb-2">
        <Text variant="micro" tone="tertiary" className="block pb-1">
          Each option has its own daily allowance. When one runs out the others are
          untouched — the counts below reset on the provider&rsquo;s own clock, not at
          midnight here.
        </Text>

        {options.map((option) => {
          const state = quotaState(option.quota)
          const isSelected = option.choice === selected
          const spent = state === 'spent'

          return (
            <button
              key={option.choice}
              type="button"
              disabled={spent}
              aria-pressed={isSelected}
              onClick={() => {
                onSelect(option.choice)
                onOpenChange(false)
              }}
              className={cn(
                'flex min-h-11 flex-col gap-1 rounded-md border px-3 py-2.5 text-left transition-colors',
                isSelected ? 'border-accent bg-accent-wash' : 'border-rule hover:bg-sunk',
                spent && 'opacity-50',
              )}
            >
              <span className="flex items-baseline justify-between gap-3">
                <Text variant="body" tone={isSelected ? 'accent' : 'primary'}>
                  {option.label}
                </Text>
                <span className={cn('tabular font-mono text-2xs', STATE_TONE[state])}>
                  {spent ? 'spent for today' : describeQuota(option.quota)}
                </span>
              </span>

              <Text variant="micro" tone="tertiary">
                {option.note}
              </Text>

              {/* A hairline, not a rounded bar: it is a gauge on an instrument, and it
                  reads at a glance without competing with the figure above it. */}
              <span aria-hidden className="mt-0.5 h-0.5 w-full overflow-hidden rounded-full bg-rule">
                <span
                  className={cn(
                    'block h-full',
                    state === 'spent' ? 'bg-neg' : state === 'low' ? 'bg-warn' : 'bg-ink-3',
                  )}
                  style={{ width: `${percentUsed(option.quota)}%` }}
                />
              </span>
            </button>
          )
        })}
      </div>
    </Sheet>
  )
}
