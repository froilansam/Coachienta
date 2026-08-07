'use client'
import { Select } from '@/components/ui/Select'
import { cn } from '@/lib/cn'

/**
 * Editable date and meal, in the sheet header.
 *
 * Ultrahuman and BitePal both put these here rather than behind a separate
 * date-picker screen, which turns retroactive logging into one tap
 * (PRD-002 §0, PRD-003 §5.1a).
 */
const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Pre-workout', 'Post-gym'] as const

const chipish =
  'h-6 rounded-sm bg-sunk px-1.5 text-2xs font-semibold uppercase tracking-[0.06em] text-ink-2 ' +
  'transition-colors hover:bg-rule focus-visible:outline-2'

export function LogHeaderChips({
  loggedOn,
  meal,
  onLoggedOnChange,
  onMealChange,
}: {
  loggedOn: string
  meal: string
  onLoggedOnChange: (v: string) => void
  onMealChange: (v: string) => void
}) {
  return (
    <>
      {/* Native date input: the OS picker is better than anything we would build,
          and it is keyboard and screen-reader accessible for free. */}
      <input
        type="date"
        aria-label="Log date"
        value={loggedOn}
        max={new Date().toISOString().slice(0, 10)}
        onChange={(e) => e.target.value && onLoggedOnChange(e.target.value)}
        className={cn(chipish, 'tabular font-mono')}
      />

      <div className="w-32">
        <Select
          label="Meal"
          value={meal}
          onChange={onMealChange}
          options={MEALS.map((m) => ({ value: m, label: m }))}
          size="md"
        />
      </div>
    </>
  )
}
