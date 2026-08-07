'use client'
import { GitMerge, Trash2 } from 'lucide-react'
import { SourceList } from '@/components/patterns/SourceList'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Field, Input } from '@/components/ui/Field'
import { NumericInput } from '@/components/ui/NumericInput'
import { Rule } from '@/components/ui/Rule'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Text } from '@/components/ui/Text'
import type { FoodEdit } from '@/hooks/useLibrary'
import { canSaveFood, checkMacros, deleteGuard, trustOf } from '@/lib/domain/food/library'
import { UnitBasis, type MacroRate } from '@/lib/schemas/domain'

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
  const check = checkMacros(rate)
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

      <Field label="Name" hint="What search has to match">
        <Input value={edit.name} enterKeyHint="done" onChange={(e) => onName(e.target.value)} />
      </Field>
      <Field label="Brand" hint="Optional">
        <Input value={edit.brand} enterKeyHint="done" onChange={(e) => onBrand(e.target.value)} />
      </Field>

      <Rule />

      <div className="flex flex-col gap-3">
        <Text variant="label">MACROS PER BASIS</Text>

        {/* Basis first: every number below it is meaningless without it. */}
        <div className="flex items-end gap-2">
          <div className="w-24">
            <Field label="Per" labelHidden>
              <NumericInput
                value={rate.basis_amount}
                onChange={(v) => onRate({ basis_amount: v ?? 0 })}
                aria-label="Basis amount"
              />
            </Field>
          </div>
          <SegmentedControl
            label="Basis unit"
            size="sm"
            value={rate.basis_unit}
            options={UnitBasis.options.map((u) => ({ value: u, label: u }))}
            onChange={(basis_unit) => onRate({ basis_unit })}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Calories">
            <NumericInput
              value={rate.kcal}
              onChange={(v) => onRate({ kcal: v ?? 0 })}
              unit="kcal"
              aria-label="Calories"
            />
          </Field>
          <Field label="Protein">
            <NumericInput
              value={rate.protein_g}
              onChange={(v) => onRate({ protein_g: v ?? 0 })}
              unit="g"
              aria-label="Protein in grams"
            />
          </Field>
          <Field label="Carbs">
            <NumericInput
              value={rate.carbs_g}
              onChange={(v) => onRate({ carbs_g: v ?? 0 })}
              unit="g"
              aria-label="Carbs in grams"
            />
          </Field>
          <Field label="Fat">
            <NumericInput
              value={rate.fat_g}
              onChange={(v) => onRate({ fat_g: v ?? 0 })}
              unit="g"
              aria-label="Fat in grams"
            />
          </Field>
          <Field label="Fibre" hint="Blank if unknown">
            <NumericInput
              value={rate.fiber_g}
              onChange={(v) => onRate({ fiber_g: v })}
              unit="g"
              aria-label="Fibre in grams"
            />
          </Field>
        </div>
      </div>

      {/*
        Live, not on blur. Fibre is the reason: entering it can clear a calorie
        mismatch outright, and watching that happen teaches the rule far better
        than a warning that appears after you have already left the field.
      */}
      <div
        className={
          check.tone === 'pos'
            ? 'flex flex-col gap-0.5 rounded-md bg-pos-wash p-3 text-pos'
            : 'flex flex-col gap-0.5 rounded-md bg-warn-wash p-3 text-warn'
        }
      >
        <Text variant="label">{check.headline}</Text>
        <span className="tabular font-mono text-2xs">{check.detail}</span>
      </div>

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
