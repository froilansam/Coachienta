'use client'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { NumericInput } from '@/components/ui/NumericInput'
import { Rule } from '@/components/ui/Rule'
import { Text } from '@/components/ui/Text'
import type { PlanRow as Row } from '@/hooks/usePlan'
import { describeExercise } from '@/lib/domain/train/exercise'

/**
 * One planned exercise: what it is, what you did last, and what to beat.
 *
 * `LAST` and `BEST` are always rendered, showing `—` when there is no history at
 * this gym (US-2.15, AC-2.19). Hevy keeps its `PREVIOUS` column populated for the
 * same reason: a column that disappears is a column you stop trusting.
 *
 * Reorder is buttons, not drag. Position is what makes the "shoulder press before
 * chest" critical rule enforceable, so it has to be reliable with one thumb — and
 * the same idiom already moves the priority list.
 */
export function PlanRowCard({
  index,
  total,
  row,
  onMove,
  onRemove,
  onSets,
  onReps,
}: {
  index: number
  total: number
  row: Row
  onMove: (delta: number) => void
  onRemove: () => void
  onSets: (v: number | null) => void
  onReps: (low: number | null, high: number | null) => void
}) {
  const { item, last, best, target } = row
  const duration = item.exercise.load_type === 'duration'
  const unit = duration ? 's' : 'reps'

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-start gap-2">
        <span className="tabular w-4 shrink-0 pt-1 font-mono text-2xs text-ink-3">{index + 1}</span>

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Text variant="body" truncate>{item.exercise.name}</Text>
          <Text variant="micro">{describeExercise(item.exercise)}</Text>
        </span>

        <Move dir="up" disabled={index === 0} name={item.exercise.name} onClick={() => onMove(-1)} />
        <Move dir="down" disabled={index === total - 1} name={item.exercise.name} onClick={() => onMove(1)} />
        <button
          type="button"
          aria-label={`Remove ${item.exercise.name}`}
          onClick={onRemove}
          className="grid size-11 shrink-0 place-items-center rounded-sm text-ink-3 hover:bg-sunk hover:text-neg"
        >
          <X size={14} strokeWidth={2} aria-hidden />
        </button>
      </div>

      {/* Set count and range are free — a template value is a default, not a
          constraint (US-2.2, AC-2.10). */}
      <div className="flex items-end gap-2 pl-6">
        <div className="w-20">
          <NumericInput
            value={item.target_sets}
            onChange={onSets}
            unit="sets"
            decimals={0}
            aria-label={`Sets for ${item.exercise.name}`}
          />
        </div>
        <div className="w-20">
          <NumericInput
            value={item.rep_low}
            onChange={(v) => onReps(v, item.rep_high)}
            decimals={0}
            aria-label={`Lowest ${unit} for ${item.exercise.name}`}
          />
        </div>
        <Text variant="micro">to</Text>
        <div className="w-20">
          <NumericInput
            value={item.rep_high}
            onChange={(v) => onReps(item.rep_low, v)}
            unit={unit}
            decimals={0}
            aria-label={`Highest ${unit} for ${item.exercise.name}`}
          />
        </div>
      </div>

      <dl className="tabular flex flex-col gap-0.5 pl-6 font-mono text-2xs">
        <div className="flex gap-2">
          <dt className="w-10 text-ink-3">LAST</dt>
          <dd className="text-ink-2">{last}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-10 text-ink-3">BEST</dt>
          <dd className="text-ink-2">{best}</dd>
        </div>
      </dl>

      {/* The suggestion, with its evidence. A target without a basis is
          unauditable — the spreadsheet's were, and went 57 days stale unnoticed
          (§3.4, AC-2.8). */}
      <div className="ml-6 flex flex-col gap-0.5 rounded-md bg-sunk px-3 py-2">
        <Text variant="label">TARGET</Text>
        <span className="tabular font-mono text-2xs text-ink">{target.suggestion}</span>
        <Text variant="micro">{target.basis}</Text>
        {item.progression_rule ? <Text variant="micro">{item.progression_rule}</Text> : null}
      </div>

      <Rule />
    </li>
  )
}

function Move({
  dir,
  disabled,
  name,
  onClick,
}: {
  dir: 'up' | 'down'
  disabled: boolean
  name: string
  onClick: () => void
}) {
  const Icon = dir === 'up' ? ChevronUp : ChevronDown
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`Move ${name} ${dir}`}
      onClick={onClick}
      className="grid size-11 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-sunk hover:text-ink disabled:opacity-30"
    >
      <Icon size={16} strokeWidth={2.5} aria-hidden />
    </button>
  )
}
