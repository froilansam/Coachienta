'use client'
import { AlertTriangle, Ban, ChevronDown, ChevronUp, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Field, Input } from '@/components/ui/Field'
import { NumericInput } from '@/components/ui/NumericInput'
import { Rule } from '@/components/ui/Rule'
import { Select } from '@/components/ui/Select'
import { Sheet } from '@/components/ui/Sheet'
import { Text } from '@/components/ui/Text'
import { Toggle } from '@/components/ui/Toggle'
import type { GoalsView } from '@/hooks/useGoals'
import type { Finding } from '@/lib/domain/coach/consistency'
import { labelOf } from '@/lib/domain/coach/priorities'

/**
 * The three editors and the prompt preview, hosted by one sheet.
 *
 * Every one of them is a **supersede**: the row you are looking at keeps its date
 * range and stays queryable, and the new one opens tomorrow. That is what lets a
 * past day be graded against the targets that were active on that day rather than
 * whatever is current when you happen to look (PRD-003 §5.1-0a).
 */
export function GoalEditors({ vm }: { vm: GoalsView }) {
  const title =
    vm.editor === 'targets'
      ? 'Change targets'
      : vm.editor === 'phase'
        ? 'Change phase'
        : vm.editor === 'priorities'
        ? 'Priority order'
        : vm.editor === 'rule'
          ? vm.ruleDraft?.supersedes
            ? 'Replace rule'
            : 'Add rule'
          : 'Prompt preview'

  const canSave =
    vm.editor === 'targets'
      ? vm.canSaveTargets
      : vm.editor === 'phase'
        ? vm.canSavePhase
        : vm.editor === 'priorities'
          ? vm.canSavePriorities
          : vm.editor === 'rule'
            ? vm.canSaveRule
            : false

  return (
    <Sheet
      open={vm.editor !== null}
      onOpenChange={(o) => !o && vm.close()}
      title={title}
      size="full"
      dismissible={!vm.isSaving}
      footer={
        <div className="flex gap-2">
          {/* "Done" rather than "Close": the Sheet's own dismiss control is
              already named Close, and you are finishing reading, not cancelling. */}
          <Button variant="ghost" onClick={vm.close}>
            {vm.editor === 'prompt' ? 'DONE' : 'Cancel'}
          </Button>
          {vm.editor === 'prompt' ? null : (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={!canSave}
              loading={vm.isSaving}
              onClick={() => void vm.save()}
            >
              SAVE
            </Button>
          )}
        </div>
      }
    >
      {vm.error ? <Chip label={vm.error} tone="neg" /> : null}

      {vm.editor === 'targets' && vm.targetsDraft ? (
        <TargetsForm vm={vm} />
      ) : vm.editor === 'phase' && vm.phaseDraft ? (
        <PhaseForm vm={vm} />
      ) : vm.editor === 'priorities' && vm.priorityDraft ? (
        <PrioritiesForm vm={vm} />
      ) : vm.editor === 'rule' && vm.ruleDraft ? (
        <RuleForm vm={vm} />
      ) : vm.editor === 'prompt' ? (
        <PromptPreview prompt={vm.prompt} tokens={vm.promptTokens} retired={vm.retiredRules.length} />
      ) : null}
    </Sheet>
  )
}

/** Findings, most severe first. A block is a refusal; a warning is information. */
export function Findings({ findings }: { findings: readonly Finding[] }) {
  if (findings.length === 0) return null
  const sorted = [...findings].sort((a) => (a.severity === 'block' ? -1 : 1))
  return (
    <div className="flex flex-col gap-1.5">
      {sorted.map((f) => (
        <div
          key={f.id + f.message}
          className={
            f.severity === 'block'
              ? 'flex items-start gap-2 rounded-md bg-neg-wash p-2.5 text-neg'
              : 'flex items-start gap-2 rounded-md bg-warn-wash p-2.5 text-warn'
          }
        >
          {f.severity === 'block' ? (
            <Ban size={13} strokeWidth={2.5} aria-hidden className="mt-0.5 shrink-0" />
          ) : (
            <AlertTriangle size={13} strokeWidth={2.5} aria-hidden className="mt-0.5 shrink-0" />
          )}
          <Text variant="micro">{f.message}</Text>
        </div>
      ))}
    </div>
  )
}

function TargetsForm({ vm }: { vm: GoalsView }) {
  const d = vm.targetsDraft!
  const set = vm.setTargets
  return (
    <div className="flex flex-col gap-3 pb-2">
      <Text variant="micro">
        The current targets stay on record and keep their date range. Past days are still graded
        against them.
      </Text>

      <Field label="In effect from" hint="The current row closes the day before">
        <Input
          type="date"
          value={d.effective_from}
          onChange={(e) => set({ effective_from: e.target.value })}
        />
      </Field>
      <Field label="Phase label">
        <Input value={d.phase_label} onChange={(e) => set({ phase_label: e.target.value })} />
      </Field>

      <Rule />
      <Text variant="label">CALORIES</Text>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Gym low">
          <NumericInput value={d.kcal_gym_low} onChange={(v) => set({ kcal_gym_low: v })} unit="kcal" decimals={0} aria-label="Gym day calorie low" />
        </Field>
        <Field label="Gym high">
          <NumericInput value={d.kcal_gym_high} onChange={(v) => set({ kcal_gym_high: v })} unit="kcal" decimals={0} aria-label="Gym day calorie high" />
        </Field>
        <Field label="Rest low">
          <NumericInput value={d.kcal_rest_low} onChange={(v) => set({ kcal_rest_low: v })} unit="kcal" decimals={0} aria-label="Rest day calorie low" />
        </Field>
        <Field label="Rest high">
          <NumericInput value={d.kcal_rest_high} onChange={(v) => set({ kcal_rest_high: v })} unit="kcal" decimals={0} aria-label="Rest day calorie high" />
        </Field>
        <Field label="Floor" hint="Hard safety limit">
          <NumericInput value={d.kcal_floor} onChange={(v) => set({ kcal_floor: v })} unit="kcal" decimals={0} aria-label="Calorie floor" />
        </Field>
      </div>

      <Rule />
      <Text variant="label">MACROS</Text>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Protein">
          <NumericInput value={d.protein_g} onChange={(v) => set({ protein_g: v ?? 0 })} unit="g" decimals={0} aria-label="Protein grams" />
        </Field>
        <Field label="Fat low">
          <NumericInput value={d.fat_low} onChange={(v) => set({ fat_low: v })} unit="g" decimals={0} aria-label="Fat low" />
        </Field>
        <Field label="Fat high">
          <NumericInput value={d.fat_high} onChange={(v) => set({ fat_high: v })} unit="g" decimals={0} aria-label="Fat high" />
        </Field>
        <Field label="Carbs gym low">
          <NumericInput value={d.carbs_gym_low} onChange={(v) => set({ carbs_gym_low: v })} unit="g" decimals={0} aria-label="Carbs gym low" />
        </Field>
        <Field label="Carbs gym high">
          <NumericInput value={d.carbs_gym_high} onChange={(v) => set({ carbs_gym_high: v })} unit="g" decimals={0} aria-label="Carbs gym high" />
        </Field>
        <Field label="Carbs rest low">
          <NumericInput value={d.carbs_rest_low} onChange={(v) => set({ carbs_rest_low: v })} unit="g" decimals={0} aria-label="Carbs rest low" />
        </Field>
        <Field label="Carbs rest high">
          <NumericInput value={d.carbs_rest_high} onChange={(v) => set({ carbs_rest_high: v })} unit="g" decimals={0} aria-label="Carbs rest high" />
        </Field>
      </div>

      <Field label="Why" hint="Optional — recorded with the row">
        <Input value={d.rationale} onChange={(e) => set({ rationale: e.target.value })} />
      </Field>

      {/*
        Live, as you type. A calorie floor discovered after pressing save is worse
        than one that greys the button out — and the same pure function decides
        both this and the server's refusal, so they cannot disagree.
      */}
      <Findings findings={vm.targetFindings} />
    </div>
  )
}

const GOAL_KINDS = ['cut', 'lean_bulk', 'maintenance', 'recomp', 'peak'] as const

function PhaseForm({ vm }: { vm: GoalsView }) {
  const d = vm.phaseDraft!
  const set = vm.setPhase
  return (
    <div className="flex flex-col gap-3 pb-2">
      <Text variant="micro">
        The current phase stays on record with its own date range.
      </Text>

      <Field label="In effect from">
        <Input type="date" value={d.effective_from} onChange={(e) => set({ effective_from: e.target.value })} />
      </Field>
      <Field label="Label">
        <Input value={d.label} onChange={(e) => set({ label: e.target.value })} />
      </Field>
      <Select
        label="Goal"
        value={d.goal_kind}
        onChange={(goal_kind) => set({ goal_kind })}
        options={GOAL_KINDS.map((g) => ({ value: g, label: g.replace(/_/g, ' ') }))}
      />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Target weight">
          <NumericInput value={d.target_weight_kg} onChange={(v) => set({ target_weight_kg: v })} unit="kg" decimals={1} aria-label="Target weight" />
        </Field>
        <Field label="Rate" hint="kg per week; 0 for maintenance">
          <NumericInput value={d.target_rate_kg_per_week} onChange={(v) => set({ target_rate_kg_per_week: v })} unit="kg/wk" decimals={2} aria-label="Target rate per week" />
        </Field>
        <Field label="Body-fat ceiling">
          <NumericInput value={d.bf_ceiling_pct} onChange={(v) => set({ bf_ceiling_pct: v })} unit="%" decimals={1} aria-label="Body fat ceiling" />
        </Field>
      </div>

      <Field label="Notes" hint="Optional">
        <Input value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
    </div>
  )
}

function PrioritiesForm({ vm }: { vm: GoalsView }) {
  const items = vm.priorityDraft!
  return (
    <div className="flex flex-col gap-3 pb-2">
      <Text variant="micro">
        Rank what you want to grow. This is not decoration — it is compared against where your
        volume actually goes, so training your #3 hardest becomes visible instead of invisible.
      </Text>

      <Rule />

      <ol className="flex flex-col">
        {items.map((item, i) => (
          <li key={item.muscle_group} className="flex flex-col gap-1 border-b border-rule py-2 last:border-0">
            <div className="flex items-center gap-2">
              <span className="tabular w-4 shrink-0 font-mono text-2xs text-ink-3">{i + 1}</span>
              <Text variant="body" className="flex-1">
                {labelOf(item.muscle_group)}
              </Text>
              {/*
                Up/down rather than drag. Five items edited twice a year: buttons
                work with one thumb, with a keyboard and with a screen reader, and
                none of the drag affordances have to be reinvented.
              */}
              <MoveButton
                dir="up"
                disabled={i === 0}
                label={`Move ${labelOf(item.muscle_group)} up`}
                onClick={() => vm.movePriority(i, -1)}
              />
              <MoveButton
                dir="down"
                disabled={i === items.length - 1}
                label={`Move ${labelOf(item.muscle_group)} down`}
                onClick={() => vm.movePriority(i, 1)}
              />
              <button
                type="button"
                disabled={items.length <= 1}
                aria-label={`Remove ${labelOf(item.muscle_group)}`}
                onClick={() => vm.removePriority(i)}
                /* 44px hit area, 14px glyph: PRD-002 asks for the target to be
                   grown with padding rather than by enlarging the visual. */
                className="grid size-11 shrink-0 place-items-center rounded-sm text-ink-3 hover:bg-sunk hover:text-neg disabled:opacity-30"
              >
                <X size={14} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div className="pl-6">
              <Input
                value={item.note ?? ''}
                placeholder="Why this rank — optional"
                aria-label={`Note for ${labelOf(item.muscle_group)}`}
                onChange={(e) => vm.setPriorityNote(i, e.target.value)}
              />
            </div>
          </li>
        ))}
      </ol>

      {vm.availableGroups.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Text variant="label">ADD A GROUP</Text>
          <div className="flex flex-wrap gap-1.5">
            {vm.availableGroups.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => vm.addPriority(g)}
                aria-label={`Add ${labelOf(g)} to the priority order`}
                className="flex min-h-11 items-center rounded-md px-1 hover:bg-sunk"
              >
                {/* Appended last: a new priority is the least important until moved. */}
                <Chip label={`+ ${labelOf(g)}`} tone="neutral" />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {vm.priorityError ? <Chip label={vm.priorityError} tone="neg" /> : null}
    </div>
  )
}

function MoveButton({
  dir,
  disabled,
  label,
  onClick,
}: {
  dir: 'up' | 'down'
  disabled: boolean
  label: string
  onClick: () => void
}) {
  const Icon = dir === 'up' ? ChevronUp : ChevronDown
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
      className="grid size-11 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-sunk hover:text-ink disabled:opacity-30"
    >
      <Icon size={16} strokeWidth={2.5} aria-hidden />
    </button>
  )
}

const CATEGORIES = [
  'persona', 'safety', 'nutrition', 'training', 'exercise_order',
  'progression', 'planning', 'phase', 'logging', 'interaction', 'output_format',
] as const

function RuleForm({ vm }: { vm: GoalsView }) {
  const d = vm.ruleDraft!
  const set = vm.setRule
  return (
    <div className="flex flex-col gap-3 pb-2">
      {d.supersedes ? (
        <Text variant="micro">
          Saving creates a replacement and retires the original. The old rule stays visible in
          history and leaves the prompt.
        </Text>
      ) : null}

      <Select
        label="Category"
        value={d.category}
        onChange={(category) => set({ category })}
        options={CATEGORIES.map((c) => ({ value: c, label: c.replace(/_/g, ' ') }))}
      />
      <Field label="Title" hint="What the rule is, in a few words">
        <Input value={d.title} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="Instruction" hint="Written as you would say it to a coach">
        <Input value={d.content} onChange={(e) => set({ content: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority" hint="Lower comes first">
          <NumericInput value={d.priority} onChange={(v) => set({ priority: v ?? 100 })} decimals={0} aria-label="Rule priority" />
        </Field>
      </div>
      <Toggle
        label="Critical"
        checked={d.is_critical}
        onCheckedChange={(is_critical) => set({ is_critical })}
      />
      <Text variant="micro">
        Critical rules lead their section in the prompt and must be enforced by the plan builder,
        not merely mentioned.
      </Text>
    </div>
  )
}

function PromptPreview({
  prompt,
  tokens,
  retired,
}: {
  prompt: string
  tokens: number
  retired: number
}) {
  return (
    <div className="flex flex-col gap-3 pb-2">
      <Text variant="micro">
        {`This is assembled by the same function the coach will call, so it is byte-for-byte what gets sent. ≈${tokens} tokens${retired > 0 ? ` · ${retired} retired rules excluded` : ''}.`}
      </Text>
      <Rule />
      {/* Monospace and pre-wrapped: whitespace is part of what is being inspected. */}
      <pre className="tabular whitespace-pre-wrap break-words font-mono text-2xs text-ink-2">
        {prompt}
      </pre>
    </div>
  )
}
