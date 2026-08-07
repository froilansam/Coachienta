'use client'
import { useMemo, useState } from 'react'
import { SearchField } from '@/components/ui/SearchField'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { auditExercise, group, matches, type Exercise } from '@/lib/domain/train/exercise'
import { ExerciseList } from './ExerciseList'

/**
 * Picking exercises from the library — shared by the day plan and the live session.
 *
 * Both screens need exactly this, and mid-session adding (US-2.18) is the whole
 * reason it is now one component instead of two copies. The search is local to the
 * sheet so it never disturbs whatever is behind it.
 *
 * `multi` is the difference between the two callers: a plan collects several before
 * closing, while mid-session you add the one machine that was free and get back to
 * lifting.
 */
export function ExercisePickerSheet({
  open,
  onOpenChange,
  exercises,
  selected,
  onToggle,
  multi = true,
  title = 'Add exercises',
  doneLabel,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  exercises: readonly Exercise[]
  selected: ReadonlySet<string>
  onToggle: (exercise: Exercise) => void
  multi?: boolean
  title?: string
  doneLabel?: string
}) {
  const [query, setQuery] = useState('')

  const sections = useMemo(() => {
    const shown = exercises.filter((e) => matches(e, query))
    return group(shown, 'muscle').map((s) => ({
      ...s,
      rows: s.exercises.map((exercise) => ({ exercise, audit: auditExercise(exercise) })),
    }))
  }, [exercises, query])

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="full"
      footer={
        multi ? (
          <Button variant="primary" size="lg" fullWidth onClick={() => onOpenChange(false)}>
            {doneLabel ?? `DONE — ${selected.size} IN PLAN`}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        <SearchField
          label="Search exercises"
          value={query}
          onChange={setQuery}
          placeholder="Name, alias, muscle or equipment"
          autoFocus
        />
        <ExerciseList
          sections={sections}
          selected={selected}
          onToggle={(exercise) => {
            onToggle(exercise)
            // Single-pick closes on choice: mid-session, one tap should be the end of
            // the interruption.
            if (!multi) onOpenChange(false)
          }}
          emptyLabel="No exercise matches that."
        />
      </div>
    </Sheet>
  )
}
