'use client'
import { Field, Input } from '@/components/ui/Field'
import { NumericInput } from '@/components/ui/NumericInput'
import { Rule } from '@/components/ui/Rule'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Text } from '@/components/ui/Text'
import { checkMacros } from '@/lib/domain/food/library'
import { UnitBasis, type MacroRate } from '@/lib/schemas/domain'

/**
 * Name, brand, basis and the five macros — the fields shared by correcting an existing
 * food and creating a new one.
 *
 * Extracted rather than reusing `FoodEditor` whole, because that component needs a real
 * row: it renders `trustOf(confidence, source)`, `v{version}`, `{times_logged}× logged`,
 * its citations and a delete guard. Opening it blank would mean inventing a v0 row
 * wearing a trust chip it has not earned — the exact dishonesty this codebase keeps
 * correcting elsewhere.
 *
 * So the *fields* are shared and the *framing* is not, because correcting and creating
 * mean different things and should not look identical.
 *
 * Display props in, events out. Knows nothing about how the food is stored.
 */
export function FoodMacroFields({
  name,
  brand,
  rate,
  onName,
  onBrand,
  onRate,
  nameHint = 'What search has to match',
  autoFocusName = false,
}: {
  name: string
  brand: string
  rate: MacroRate
  onName: (v: string) => void
  onBrand: (v: string) => void
  onRate: (patch: Partial<MacroRate>) => void
  nameHint?: string
  autoFocusName?: boolean
}) {
  const check = checkMacros(rate)

  return (
    <>
      <Field label="Name" hint={nameHint}>
        <Input
          value={name}
          enterKeyHint="done"
          autoFocus={autoFocusName}
          onChange={(e) => onName(e.target.value)}
        />
      </Field>
      <Field label="Brand" hint="Optional">
        <Input value={brand} enterKeyHint="done" onChange={(e) => onBrand(e.target.value)} />
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
        Live, not on blur. Fibre is the reason: entering it can clear a calorie mismatch
        outright, and watching that happen teaches the rule far better than a warning
        that appears after you have already left the field.
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
    </>
  )
}
