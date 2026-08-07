'use client'
import { DotPlot } from '@/components/patterns/DotPlot'
import { LineSet } from '@/components/patterns/LineSet'
import { Panel } from '@/components/patterns/Panel'
import { BarLegend, StackedBars } from '@/components/patterns/StackedBars'
import { WeekGrid } from '@/components/patterns/WeekGrid'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Select } from '@/components/ui/Select'
import { SkeletonList } from '@/components/ui/Skeleton'
import { Text } from '@/components/ui/Text'
import { useTrends, type Measure, type Range } from '@/hooks/useTrends'
import { AdherencePanel } from './AdherencePanel'

/**
 * Trends. One hook call, then JSX.
 *
 * Ordered by what it changes rather than by what is easiest to draw: adherence
 * first (it answers a question you asked), then the two honest measures of work,
 * then strength, then records, then showing up.
 */
const RANGES: ReadonlyArray<{ value: Range; label: string }> = [
  { value: '28', label: '4w' },
  { value: '84', label: '12w' },
  { value: '168', label: '24w' },
]

const MEASURES: ReadonlyArray<{ value: Measure; label: string }> = [
  { value: 'volume_kg', label: 'Volume' },
  { value: 'set_count', label: 'Sets' },
]

export function TrendsScreen() {
  const vm = useTrends()

  if (vm.loadError) {
    return (
      <main className="mx-auto w-full max-w-lg px-4 py-8">
        <EmptyState
          title="CANNOT REACH THE SERVER"
          body="Trends are computed on the spot from your logged sets, so they need a connection. Your queued sets are safe on this device."
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
    <main className="mx-auto flex w-full max-w-lg flex-col gap-8 px-4 pt-6 pb-8">
      <header className="flex items-baseline justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Text as="h1" variant="title">
            Trends
          </Text>
          <Text variant="micro">{vm.gymName}</Text>
        </div>
        <SegmentedControl
          options={RANGES}
          value={vm.range}
          onChange={vm.setRange}
          label="Range"
          size="sm"
        />
      </header>

      {vm.isLoading ? (
        <SkeletonList rows={10} />
      ) : vm.isEmpty ? (
        <EmptyState
          title="NOTHING LOGGED YET"
          body="Log a session and these six charts fill themselves in. None of them is stored — every figure is recomputed from your sets each time you open this screen."
        />
      ) : (
        <>
          <AdherencePanel rows={vm.adherenceRows} note={vm.adherenceNote} />

          <Panel
            title={vm.measure === 'volume_kg' ? 'Volume by muscle group' : 'Sets by muscle group'}
            caption={
              vm.measure === 'volume_kg'
                ? 'Weekly, volume-eligible sets only. Planks, ab-machine holds and assisted work carry no kilograms by definition — see them on SETS.'
                : 'Weekly. The honest measure for abs and isolation work, which do the reps without moving a comparable load.'
            }
            control={
              <SegmentedControl
                options={MEASURES}
                value={vm.measure}
                onChange={vm.setMeasure}
                label="Measure"
                size="sm"
              />
            }
            footer={
              <div className="flex flex-col gap-2 pt-1">
                <BarLegend items={vm.legend} unit={vm.measureUnit} />
                {/* AC-2.14: a leak gets a sentence, not a silent zero. */}
                {vm.leak ? (
                  <Text variant="micro" tone="neg">
                    {vm.leak}
                  </Text>
                ) : null}
              </div>
            }
          >
            <StackedBars bars={vm.bars} unit={vm.measureUnit} />
          </Panel>

          <Panel
            title="Strength progression"
            caption={
              vm.betterIsDown
                ? 'Assistance needed, so DOWN is stronger. One line per gym.'
                : 'Estimated one-rep max from the top set (Epley), so a heavy triple and a light twelve sit on the same axis. One line per gym — a cable stack marked 45 kg is not the same 45 kg at another gym.'
            }
          >
            {/* Its own row rather than crammed beside the heading: an exercise name
                needs the width, and a 44 px target does not belong in a header. */}
            {vm.subjects.length > 0 ? (
              <Select
                label="Exercise"
                value={vm.subjectId ?? ''}
                onChange={vm.setSubjectId}
                options={vm.subjects.map((s) => ({ value: s.id, label: s.name }))}
              />
            ) : null}
            <LineSet
              lines={vm.lines}
              unit={vm.lineUnit}
              betterIsDown={vm.betterIsDown}
              emptyLabel="No exercise has been logged on two separate days yet — one point is a reading, not a trend."
            />
          </Panel>

          <Panel
            title="PR timeline"
            caption="Records at this gym in the last 6 months, by what was beaten. A first attempt is a baseline, not a record."
          >
            <DotPlot
              dots={vm.prDots}
              lanes={vm.prLanes}
              emptyLabel="No records yet at this gym. The first session at a new gym sets baselines instead."
            />
          </Panel>

          <Panel title="Session frequency" caption={vm.frequency}>
            <WeekGrid rows={vm.weeks} columnLabels={vm.weekdayLabels} target={vm.target} />
          </Panel>
        </>
      )}
    </main>
  )
}
