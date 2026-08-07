'use client'
import { Plus } from 'lucide-react'
import { Text } from '@/components/ui/Text'

/**
 * `＋ Add "chicken adobo"` — the last row of the search results.
 *
 * PRD-003 §534 specced this as a `[ LOOK UP ]` button shown only when there were no
 * matches. It sits at the END of the list unconditionally instead, because "none of
 * these is what I meant" is just as common as "nothing matched" — and the route's own
 * copy has been promising *"Enter the macros yourself"* to a UI that offered nowhere
 * to do it.
 *
 * Display props only. It does not know what creating a food involves.
 */
export function CreateFoodRow({ query, onCreate }: { query: string; onCreate: () => void }) {
  return (
    <button
      type="button"
      onClick={onCreate}
      aria-label={`Add ${query} as a new food`}
      className="flex min-h-11 w-full items-center gap-2.5 border-t border-rule py-3 text-left hover:bg-sunk"
    >
      <Plus size={16} strokeWidth={2} aria-hidden className="shrink-0 text-accent-ink" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <Text variant="body" truncate>
          {`Not in the list? Add “${query}”`}
        </Text>
        <Text variant="micro">Enter the macros once and it is searchable from then on.</Text>
      </span>
    </button>
  )
}
