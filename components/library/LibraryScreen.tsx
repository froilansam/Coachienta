'use client'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Rule } from '@/components/ui/Rule'
import { SearchField } from '@/components/ui/SearchField'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { SkeletonList } from '@/components/ui/Skeleton'
import { Text } from '@/components/ui/Text'
import { useLibrary } from '@/hooks/useLibrary'
import { canSaveFood, FILTER_BLURB, filterOptions } from '@/lib/domain/food/library'
import { FoodEditor } from './FoodEditor'
import { LibraryRow } from './LibraryRow'
import { MergePicker } from './MergePicker'

/**
 * The food library. One hook call, then JSX.
 *
 * This is the screen the spreadsheet's "Usual Foods" tab wanted to be. Its real
 * job is triage, not browsing: 67% of the library is unconfirmed estimates and
 * 21% has never been eaten, so the filters lead and the counts are visible before
 * you tap anything.
 */
export function LibraryScreen() {
  const vm = useLibrary()
  const blurb = FILTER_BLURB[vm.filter]

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 pt-6 pb-8">
      <Text as="h1" variant="title">
        Food library
      </Text>

      <SearchField
        label="Search your library"
        value={vm.query}
        onChange={vm.setQuery}
        placeholder="Name, brand or an old spelling"
      />

      {/* Counts live in the labels: the point of the screen is how much needs
          attention, and a chip that says CHECK 188 states it without a legend. */}
      <div className="-mx-4 overflow-x-auto px-4">
        <SegmentedControl
          label="Filter the library"
          size="sm"
          value={vm.filter}
          options={filterOptions(vm.counts)}
          onChange={vm.setFilter}
        />
      </div>

      {blurb ? <Text variant="micro">{blurb}</Text> : null}

      {vm.notice ? <Chip label={vm.notice} tone="accent" /> : null}

      {vm.filter === 'unlogged' && vm.counts.unlogged > 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-rule bg-sunk p-3">
          <Text variant="micro">
            {`Nothing here has ever been logged, so nothing depends on it.`}
          </Text>
          <Button
            variant="danger"
            size="sm"
            iconStart={Trash2}
            loading={vm.isBusy}
            onClick={() => void vm.prune()}
          >
            {`CLEAR ${vm.counts.unlogged}`}
          </Button>
        </div>
      ) : null}

      {vm.isLoading && vm.foods.length === 0 ? (
        <SkeletonList rows={8} />
      ) : vm.foods.length === 0 ? (
        <EmptyState
          title="NOTHING HERE"
          body={vm.query ? 'No food matches that.' : 'This filter is empty — good news.'}
        />
      ) : (
        <div className="flex flex-col">
          <Rule />
          {vm.foods.map((f) => (
            <LibraryRow key={f.id} food={f} onOpen={() => vm.open(f)} />
          ))}
        </div>
      )}

      <Sheet
        open={vm.edit !== null}
        onOpenChange={(o) => !o && vm.close()}
        title={vm.mergePicking ? 'Merge foods' : 'Correct food'}
        size="full"
        dismissible={!vm.isBusy}
        footer={
          vm.edit ? (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={vm.close}>
                Cancel
              </Button>
              {vm.mergeWith ? (
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  disabled={vm.mergeError !== null}
                  loading={vm.isBusy}
                  onClick={() => void vm.confirmMerge()}
                >
                  MERGE
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  disabled={!canSaveFood(vm.edit.name, vm.edit.rate)}
                  loading={vm.isBusy}
                  onClick={() => void vm.save()}
                >
                  SAVE &amp; VERIFY
                </Button>
              )}
            </div>
          ) : null
        }
      >
        {vm.edit ? (
          vm.mergePicking ? (
            <MergePicker
              source={vm.edit.food}
              candidates={vm.mergeCandidates}
              query={vm.mergeQuery}
              onQuery={vm.setMergeQuery}
              chosen={vm.mergeWith}
              onChoose={vm.pickMerge}
              survivorId={vm.survivorId}
              onSurvivor={vm.setSurvivorId}
              error={vm.mergeError}
            />
          ) : (
            <FoodEditor
              edit={vm.edit}
              onName={vm.setName}
              onBrand={vm.setBrand}
              onRate={vm.setRate}
              onMergeStart={vm.startMerge}
              onDelete={() => void vm.remove(vm.edit!.food)}
            />
          )
        ) : null}
      </Sheet>
    </main>
  )
}
