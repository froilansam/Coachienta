'use client'
import { GitMerge, Trash2 } from 'lucide-react'
import { FoodMacroFields } from '@/components/food/FoodMacroFields'
import { SourceList } from '@/components/patterns/SourceList'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Rule } from '@/components/ui/Rule'
import { Text } from '@/components/ui/Text'
import type { FoodEdit } from '@/hooks/useLibrary'
import { canSaveFood, deleteGuard, trustOf } from '@/lib/domain/food/library'
import type { MacroRate } from '@/lib/schemas/domain'

/**
 * Correct one food. Saving marks it `user_verified` and bumps `version` —
 * and leaves every past log entry exactly as it was (PRD-003 §4.3, AC-1.6).
 *
 * That guarantee is stated on the screen rather than buried in the PRD, because
 * "will this change my old charts?" is the first thing anyone wonders before
 * editing a food they have logged 154 times.
 */
export function FoodEditor({
  edit,
  onName,
  onBrand,
  onRate,
  onMergeStart,
  onDelete,
}: {
  edit: FoodEdit
  onName: (v: string) => void
  onBrand: (v: string) => void
  onRate: (patch: Partial<MacroRate>) => void
  onMergeStart: () => void
  onDelete: () => void
}) {
  const { food, rate } = edit
  const trust = trustOf(food.confidence, food.source)
  const guard = deleteGuard(food)

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="flex items-center justify-between gap-2">
        <Chip label={trust.label} tone={trust.tone === 'neutral' ? 'neutral' : trust.tone} />
        <Text variant="micro">
          {`${food.times_logged}× logged · v${food.version}`}
        </Text>
      </div>
      <Text variant="micro">{trust.explain}</Text>
      <SourceList
        sources={food.citations ?? []}
        emptyLabel="No source recorded — these numbers were entered by hand."
      />

      <FoodMacroFields
        name={edit.name}
        brand={edit.brand}
        rate={rate}
        onName={onName}
        onBrand={onBrand}
        onRate={onRate}
      />

      <Rule />

      <div className="flex flex-col gap-2">
        <Text variant="micro">
          Saving marks this verified and applies from now on. Entries you have already logged keep
          the numbers they were logged with.
        </Text>
        <div className="flex gap-2">
          <Button variant="secondary" iconStart={GitMerge} onClick={onMergeStart}>
            MERGE
          </Button>
          <Button
            variant="ghost"
            iconStart={Trash2}
            disabled={!guard.allowed}
            onClick={onDelete}
            title={guard.reason ?? undefined}
          >
            DELETE
          </Button>
        </div>
        {/* The reason names the real dependency, not a counter. Saying "in 1 past
            entry" when that entry was deleted is worse than saying nothing. */}
        {guard.reason ? <Text variant="micro">{guard.reason}</Text> : null}
        {guard.warning ? <Chip label={guard.warning} tone="warn" /> : null}
      </div>

      {canSaveFood(edit.name, rate) ? null : (
        <Chip label="A name and a basis amount are required" tone="warn" />
      )}
    </div>
  )
}
