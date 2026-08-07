'use client'
import { AlertTriangle, Check, Plus } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { Rule } from '@/components/ui/Rule'
import { Text } from '@/components/ui/Text'
import { cn } from '@/lib/cn'
import {
  describeExercise,
  LOAD_TYPE_META,
  needsAttention,
  type Audit,
  type Exercise,
  type LoadType,
} from '@/lib/domain/train/exercise'

/**
 * The exercise list, in sections. **Agnostic of why you are looking at it.**
 *
 * Two modes from one component:
 * - `onOpen` — tapping a row opens it. The library uses this to correct a row.
 * - `selected` + `onToggle` — tapping a row picks it, with a `＋ / ✓` affordance
 *   (MyFitnessPal's in-place swap, already used by the food results row).
 *
 * The day plan and the AI draft both need a picker over the same rows with the same
 * search and grouping, so the alternative to one agnostic list is three lists that
 * drift. It knows nothing about the database, the editor, or plans.
 *
 * No thumbnails, per PRD-002 §0: the user knows these movements, and images cost
 * the vertical space the meta line needs.
 */
export interface ExerciseListRow {
  exercise: Exercise
  audit: Audit
}

export interface ExerciseListSection {
  key: string
  label: string
  rows: ExerciseListRow[]
}

export function ExerciseList({
  sections,
  selected,
  onToggle,
  onOpen,
  emptyLabel = 'Nothing matches.',
}: {
  sections: readonly ExerciseListSection[]
  /** Selection mode. Omit for a browse-only list. */
  selected?: ReadonlySet<string>
  onToggle?: (e: Exercise) => void
  onOpen?: (e: Exercise) => void
  emptyLabel?: string
}) {
  if (sections.length === 0) {
    return <Text variant="micro">{emptyLabel}</Text>
  }

  return (
    <div className="flex flex-col gap-4">
      {sections.map((s) => (
        <section key={s.key} className="flex flex-col">
          {/* Sticky section headers: the whole point of grouping is knowing where
              you are once you have scrolled past the top of a group. */}
          <div className="sticky top-0 z-10 flex items-baseline justify-between gap-3 bg-bg py-1">
            <Text variant="label">{s.label}</Text>
            <Text variant="micro">{s.rows.length}</Text>
          </div>
          <Rule />
          {s.rows.map(({ exercise, audit }) => (
            <Row
              key={exercise.id}
              exercise={exercise}
              audit={audit}
              picked={selected?.has(exercise.id) ?? false}
              selectable={onToggle !== undefined}
              onActivate={() => (onToggle ? onToggle(exercise) : onOpen?.(exercise))}
            />
          ))}
        </section>
      ))}
    </div>
  )
}

function Row({
  exercise,
  audit,
  picked,
  selectable,
  onActivate,
}: {
  exercise: Exercise
  audit: Audit
  picked: boolean
  selectable: boolean
  onActivate: () => void
}) {
  const meta = LOAD_TYPE_META[exercise.load_type as LoadType]
  const flagged = needsAttention(audit)

  return (
    <button
      type="button"
      onClick={onActivate}
      aria-pressed={selectable ? picked : undefined}
      /* min-h-11 keeps every row a 44px target even when the meta line wraps
         short (PRD-002). */
      className="-mx-2 flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-sunk"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <Text variant="body" truncate>
            {exercise.name}
          </Text>
          {/* A flag is the reason to open this row, so it sits with the name. */}
          {flagged ? (
            <AlertTriangle size={12} strokeWidth={2.5} aria-hidden className="shrink-0 text-warn" />
          ) : null}
          {exercise.is_active ? null : <Chip label="RETIRED" tone="neutral" size="sm" />}
        </span>
        <Text variant="micro">{describeExercise(exercise)}</Text>
      </span>

      {/* Load type is the field that decides what this exercise's numbers MEAN, so
          it is on the row rather than hidden in the editor. */}
      <span className="shrink-0">
        <Chip
          label={meta?.label ?? exercise.load_type}
          tone={exercise.load_type === 'external_weight' ? 'neutral' : 'accent'}
          size="sm"
        />
      </span>

      {exercise.set_count > 0 ? (
        <span className="tabular w-12 shrink-0 text-right font-mono text-2xs text-ink-3">
          {`${exercise.set_count} set${exercise.set_count === 1 ? '' : 's'}`}
        </span>
      ) : null}

      {selectable ? (
        <span
          aria-hidden
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-full transition-colors',
            picked ? 'bg-accent text-on-accent' : 'bg-sunk text-ink-2',
          )}
        >
          {picked ? <Check size={15} strokeWidth={3} /> : <Plus size={15} strokeWidth={2.5} />}
        </span>
      ) : null}
    </button>
  )
}
