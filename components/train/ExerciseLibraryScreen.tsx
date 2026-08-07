'use client'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchField } from '@/components/ui/SearchField'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { SkeletonList } from '@/components/ui/Skeleton'
import { Text } from '@/components/ui/Text'
import { useExerciseLibrary, type LibraryFilter } from '@/hooks/useExerciseLibrary'
import { muscleLabel, type GroupBy } from '@/lib/domain/train/exercise'
import { ExerciseEditor } from './ExerciseEditor'
import { ExerciseList } from './ExerciseList'

/**
 * The exercise library. One hook call, then JSX.
 *
 * Its job is maintenance, not picking — picking happens on the day plan, which
 * reuses `ExerciseList` in selection mode. What maintenance means here is
 * concrete: 57 imported rows, and PRD-004 §4.1's claim that the mis-tagged chest
 * presses and superset names were "corrected on import" does not hold against the
 * data. `NEEDS CHECK` is how you see that.
 */
export function ExerciseLibraryScreen() {
  const vm = useExerciseLibrary()

  if (vm.loadError) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-8">
        <EmptyState
          title="CANNOT REACH THE SERVER"
          body="The exercise library could not be loaded."
          action={
            <Button variant="secondary" onClick={vm.retry}>
              TRY AGAIN
            </Button>
          }
        />
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 pt-6 pb-8">
      <div className="flex items-center justify-between gap-3">
        <Text as="h1" variant="title">Exercises</Text>
        <Button variant="secondary" size="sm" iconStart={Plus} onClick={vm.openNew}>
          NEW
        </Button>
      </div>

      <SearchField
        label="Search exercises"
        value={vm.query}
        onChange={vm.setQuery}
        placeholder="Name, alias, muscle or equipment"
      />

      {/* Counts in the labels, same as the food library: the number IS the reason
          to tap. */}
      <div className="-mx-4 overflow-x-auto px-4">
        <SegmentedControl
          label="Filter the library"
          size="sm"
          value={vm.filter}
          options={[
            { value: 'all' as LibraryFilter, label: `ALL ${vm.counts.all}` },
            { value: 'attention' as LibraryFilter, label: `NEEDS CHECK ${vm.counts.attention}` },
            { value: 'retired' as LibraryFilter, label: `RETIRED ${vm.counts.retired}` },
          ]}
          onChange={vm.setFilter}
        />
      </div>

      {vm.filter === 'attention' ? (
        <Text variant="micro">
          Rows whose movement pattern looks wrong for their muscle group, or whose name still
          carries a superset prefix. Muscle group is what per-muscle volume is grouped by, so a
          wrong one quietly distorts your priority adherence.
        </Text>
      ) : null}

      {/* Muscle narrowing as removable chips (Equinox+), because filters combine
          and tabs do not. */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        <button type="button" onClick={() => vm.setMuscle(null)}>
          <Chip label="ALL MUSCLES" tone={vm.muscle === null ? 'accent' : 'neutral'} />
        </button>
        {vm.muscles.map((m) => (
          <button key={m} type="button" onClick={() => vm.setMuscle(vm.muscle === m ? null : m)}>
            <Chip label={muscleLabel(m)} tone={vm.muscle === m ? 'accent' : 'neutral'} />
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <Text variant="micro">{`${vm.shownCount} shown`}</Text>
        <SegmentedControl
          label="Group by"
          size="sm"
          value={vm.groupBy}
          options={[
            { value: 'muscle' as GroupBy, label: 'BY MUSCLE' },
            { value: 'alpha' as GroupBy, label: 'A–Z' },
          ]}
          onChange={vm.setGroupBy}
        />
      </div>

      {vm.notice ? <Chip label={vm.notice} tone="accent" /> : null}

      {vm.isLoading ? (
        <SkeletonList rows={10} />
      ) : (
        <ExerciseList
          sections={vm.groups}
          onOpen={vm.openEdit}
          emptyLabel={
            vm.filter === 'attention'
              ? 'Nothing needs checking — every row looks consistent.'
              : 'No exercise matches that.'
          }
        />
      )}

      <Sheet
        open={vm.edit !== null}
        onOpenChange={(o) => !o && vm.close()}
        title={vm.edit?.original ? 'Correct exercise' : 'New exercise'}
        size="full"
        dismissible={!vm.isSaving}
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={vm.close}>Cancel</Button>
            {vm.edit?.original ? (
              <Button
                variant="ghost"
                onClick={() => void vm.setActive(vm.edit!.original!, !vm.edit!.original!.is_active)}
              >
                {vm.edit.original.is_active ? 'RETIRE' : 'RESTORE'}
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="lg"
              fullWidth
              disabled={!vm.canSave}
              loading={vm.isSaving}
              onClick={() => void vm.save()}
            >
              SAVE
            </Button>
          </div>
        }
      >
        {vm.edit ? <ExerciseEditor vm={vm} /> : null}
      </Sheet>
    </main>
  )
}
