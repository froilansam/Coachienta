'use client'
import { Trash2 } from 'lucide-react'
import { FeedbackButtons } from '@/components/patterns/FeedbackButtons'
import { ProvenanceHeader } from '@/components/patterns/ProvenanceHeader'
import { Checkbox } from '@/components/ui/Checkbox'
import { Chip } from '@/components/ui/Chip'
import { IconButton } from '@/components/ui/Button'
import { NumericInput } from '@/components/ui/NumericInput'
import { NumericValue } from '@/components/ui/NumericValue'
import { Rule } from '@/components/ui/Rule'
import { Text } from '@/components/ui/Text'
import type { ReviewItem } from '@/hooks/usePhotoDraft'
import type { Macros } from '@/lib/schemas/domain'

/**
 * Candidate review. Names come pre-filled; GRAMS are the editable, focused field.
 *
 * That split follows where the model is actually good: it identifies food well and
 * judges portions badly. Nothing commits without the user confirming
 * (AC-1.9) — this screen has no auto-save path at all.
 */
export function PhotoReview({
  previewUrl,
  dishName,
  items,
  total,
  unmatchedCount,
  explain = 'Names were read from your photo. Amounts are estimates — check the grams before logging.',
  onAmountChange,
  onToggle,
  onRemove,
}: {
  previewUrl: string | null
  dishName: string | null
  items: readonly ReviewItem[]
  total: Macros
  unmatchedCount: number
  /** Why these rows exist. A pasted note is not a photo, and the copy has to say so. */
  explain?: string
  onAmountChange: (key: string, amount: number | null) => void
  onToggle: (key: string) => void
  onRemove: (key: string) => void
}) {
  return (
    <div className="flex flex-col gap-4 pb-2">
      {previewUrl || dishName ? (
        <div className="flex items-center gap-3">
          {previewUrl ? (
            // The photo stays on screen while you correct amounts — you are
            // comparing the numbers against it, not remembering it.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="The food you photographed"
              className="size-16 shrink-0 rounded-md object-cover"
            />
          ) : null}
          {dishName ? (
            <Text as="h3" variant="body">
              {dishName}
            </Text>
          ) : null}
        </div>
      ) : null}

      <ProvenanceHeader label="AI-DETECTED ITEMS" explain={explain} />

      <div className="flex flex-col">
        {items.map((item) => (
          <div key={item.key} className="flex flex-col gap-2 py-3">
            <div className="flex items-start gap-3">
              <Checkbox
                checked={item.included}
                label={`Include ${item.name}`}
                onCheckedChange={() => onToggle(item.key)}
              />

              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Text variant="body" truncate>
                  {item.name}
                </Text>
                {item.food && item.food.name !== item.name ? (
                  <Text variant="micro">{item.food.name}</Text>
                ) : null}
                {/* Why the model thought this size — you cannot correct an
                    estimate you cannot see the basis for. */}
                <Text variant="micro">{item.reasoning}</Text>
              </div>

              <IconButton
                icon={Trash2}
                label={`Remove ${item.name}`}
                variant="ghost"
                size="sm"
                onClick={() => onRemove(item.key)}
              />
            </div>

            <div className="flex items-center gap-3 pl-11">
              <div className="w-28">
                <NumericInput
                  value={item.amount}
                  onChange={(v) => onAmountChange(item.key, v)}
                  unit={item.unit}
                  aria-label={`Amount of ${item.name} in ${item.unit}`}
                />
              </div>

              {item.food ? (
                <span className="tabular flex flex-1 flex-wrap items-baseline gap-x-2 font-mono text-2xs text-ink-3">
                  <NumericValue value={item.macros?.kcal ?? null} unit="kcal" size="compact" tone="secondary" />
                  <span>P {item.macros?.protein_g ?? '—'}</span>
                  <span>C {item.macros?.carbs_g ?? '—'}</span>
                  <span>F {item.macros?.fat_g ?? '—'}</span>
                </span>
              ) : (
                <Chip label="No match — type it" tone="warn" />
              )}
            </div>
          </div>
        ))}
      </div>

      <Rule />

      <div className="flex items-baseline justify-between gap-3">
        <Text variant="label">TOTAL</Text>
        <span className="tabular flex items-baseline gap-3 font-mono text-sm">
          <NumericValue value={total.kcal} unit="kcal" />
          <span className="text-ink-3">P {total.protein_g}</span>
          <span className="text-ink-3">C {total.carbs_g}</span>
          <span className="text-ink-3">F {total.fat_g}</span>
        </span>
      </div>

      {unmatchedCount > 0 ? (
        <Chip
          label={`${unmatchedCount} item${unmatchedCount > 1 ? 's' : ''} had no macro match and will be skipped`}
          tone="warn"
        />
      ) : null}

      <FeedbackButtons prompt="How did that reading go?" />
    </div>
  )
}
