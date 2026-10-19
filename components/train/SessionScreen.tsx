'use client'
import { CheckCheck, Plus } from 'lucide-react'
import { ConfirmSheet } from '@/components/patterns/ConfirmSheet'
import { MetricStrip } from '@/components/patterns/MetricStrip'
import { SyncBadge } from '@/components/patterns/SyncBadge'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Rule } from '@/components/ui/Rule'
import { SkeletonList } from '@/components/ui/Skeleton'
import { Text } from '@/components/ui/Text'
import { useSession } from '@/hooks/useSession'
import { useSyncStatus } from '@/hooks/useSyncStatus'
import { ExerciseBlockView } from './ExerciseBlock'
import { SessionReviewCard } from './SessionReview'
import { ExercisePickerSheet } from './ExercisePickerSheet'
import { RestOverlay } from './RestOverlay'

/**
 * The live session — the screen this feature exists for.
 *
 * Two hook calls and JSX. Every commit is a local write, so the row locks with no
 * network await (AC-2.1), and the `SyncBadge` in the header is the honest signal
 * about what has actually reached the server. That separation is the point: logging
 * must never wait on connectivity, and it must never pretend to have uploaded.
 */
export function SessionScreen({ sessionId }: { sessionId: string }) {
  const vm = useSession(sessionId)
  const sync = useSyncStatus()

  if (vm.notFound) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-8">
        <EmptyState title="NO SUCH SESSION" body="That session does not exist. Plan a new one from Train." />
      </main>
    )
  }

  if (vm.loadError) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-8">
        <EmptyState
          title="CANNOT REACH THE SERVER"
          body="This session could not be loaded. Sets you log offline are safe — they are queued on this device."
          action={<Button variant="secondary" onClick={vm.retry}>TRY AGAIN</Button>}
        />
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-4 px-4 pt-6 pb-24">
      <header className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col gap-0.5">
          <Text as="h1" variant="title" truncate>{vm.name}</Text>
          <Text variant="micro">{`${vm.performedOn} · ${vm.gymName}`}</Text>
        </span>
        <SyncBadge
          online={sync.online}
          pending={sync.pending}
          failed={sync.failed}
          onRetry={sync.retry}
        />
      </header>

      {/* Hevy's session strip. Volume counts eligible sets only — a plank adds a
          set and no kilograms (AC-2.4). */}
      <MetricStrip
        metrics={[
          { label: 'DURATION', value: null, display: vm.elapsed },
          { label: 'VOLUME', value: vm.totals.volumeKg, unit: 'kg' },
          { label: 'SETS', value: vm.totals.sets },
        ]}
      />
      {vm.totals.volumelessSets > 0 ? (
        <Text variant="micro">
          {`${vm.totals.volumelessSets} of those sets carry no volume by definition — timed and assisted work is counted as sets, never as kilograms.`}
        </Text>
      ) : null}

      {/* `self-start`: the parent is a stretch flex column, so an inline-flex Chip
          still gets stretched to the full width and reads as a banner. */}
      {vm.isFinished ? <Chip label="Finished" tone="pos" className="self-start" /> : null}

      <SessionReviewCard
        status={vm.reviewStatus}
        review={vm.review}
        error={vm.reviewError}
        onRetry={vm.retryReview}
      />

      <Rule strong />

      {vm.isLoading ? (
        <SkeletonList rows={8} />
      ) : (
        <>
          {vm.blocks.length === 0 ? (
            <EmptyState
              title="NO EXERCISES"
              body="Nothing is planned for this session. Add what you are about to do."
            />
          ) : (
            vm.blocks.map((block) => (
              <ExerciseBlockView key={`${block.position}-${block.exercise.id}`} block={block} vm={vm} />
            ))
          )}

          {/* The machine was occupied, so you do something else. First-class, not an
              edge case (§6) — and it appends, so it lands where you are. */}
          <Button
            variant="secondary"
            fullWidth
            iconStart={Plus}
            loading={vm.isEditing}
            onClick={vm.openPicker}
          >
            ADD EXERCISE
          </Button>
          {vm.editError ? (
            <Text variant="micro" tone="neg">
              {vm.editError}
            </Text>
          ) : null}

          {/*
            Gone once the session is finished, rather than disabled. A full-width
            accent button is the heaviest thing on the screen, and spending that weight
            on a dead control makes the one real action — ADD EXERCISE — look
            secondary to it. The `Finished` chip above already says the state.
          */}
          {vm.isFinished ? null : (
            <>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                iconStart={CheckCheck}
                loading={vm.isFinishing}
                onClick={() => void vm.finish()}
              >
                FINISH SESSION
              </Button>
              <Text variant="micro">
                Finishing stamps the clock. Sets are already saved on this device the moment you
                tick them. The coach reads the session after that.
              </Text>
            </>
          )}
        </>
      )}

      {vm.rest ? (
        <RestOverlay remaining={vm.rest.remaining} onAdjust={vm.adjustRest} onSkip={vm.skipRest} />
      ) : null}

      <ExercisePickerSheet
        open={vm.pickerOpen}
        onOpenChange={(o) => (o ? vm.openPicker() : vm.closePicker())}
        exercises={vm.library}
        selected={new Set(vm.blocks.map((b) => b.exercise.id))}
        onToggle={(e) => void vm.addExercise(e.id)}
        multi={false}
        title="Add an exercise"
      />

      <ConfirmSheet
        open={vm.pendingRemoval !== null}
        title="Remove exercise"
        body={vm.removalText}
        confirmLabel="REMOVE"
        isBusy={vm.isEditing}
        onCancel={vm.cancelRemove}
        onConfirm={() => void vm.confirmRemove()}
      />
    </main>
  )
}
