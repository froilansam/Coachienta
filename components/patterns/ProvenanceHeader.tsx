import { Info } from 'lucide-react'
import { Text } from '@/components/ui/Text'
import { Tooltip } from '@/components/ui/Tooltip'

/**
 * Labels a whole group as AI-generated, rather than badging every row.
 *
 * BitePal's "AI-detected ingredients ⓘ" — cleaner than a per-row EST chip, and
 * it draws an explicit line between what the model guessed and what you entered
 * (PRD-002 §0, PRD-007 §4.7).
 */
export function ProvenanceHeader({ label, explain }: { label: string; explain: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Text variant="label">{label}</Text>
      <Tooltip content={explain}>
        <button
          type="button"
          aria-label={explain}
          className="grid size-5 place-items-center rounded-full text-ink-3 hover:text-ink-2"
        >
          <Info size={12} strokeWidth={2} aria-hidden />
        </button>
      </Tooltip>
    </div>
  )
}
