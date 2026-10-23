'use client'
import { BandLine } from '@/components/patterns/BandLine'
import { DotPlot } from '@/components/patterns/DotPlot'
import { LineSet } from '@/components/patterns/LineSet'
import { MetricStrip } from '@/components/patterns/MetricStrip'
import { Panel } from '@/components/patterns/Panel'
import { BarLegend, StackedBars } from '@/components/patterns/StackedBars'
import { TickBars } from '@/components/patterns/TickBars'
import { WeekGrid } from '@/components/patterns/WeekGrid'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Select } from '@/components/ui/Select'
import { SkeletonList } from '@/components/ui/Skeleton'
import { Text } from '@/components/ui/Text'
import { useTrends, type Measure, type Range, type TrendsDomain } from '@/hooks/useTrends'
import { AdherencePanel } from './AdherencePanel'
import { FoodReport } from './FoodReport'

/**
 * Trends — food intake and training, one screen, one range control.
 *
 * Ordered by what it changes: adherence first, then the honest measures of work
 * (or intake), then records / quality. Domain switch is a segment, not a route,
 * so the range you picked for train is still the range when you flip to food.
 */
const RANGES: ReadonlyArray<{ value: Range; label: string }> = [
  { value: '28', label: '4w' },
  { value: '84', label: '12w' },
  { value: '168', label: '24w' },
]

const DOMAINS: ReadonlyArray<{ value: TrendsDomain; label: string }> = [
  { value: 'food', label: 'Food' },
  { value: 'train', label: 'Train' },
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
          body="Trends are computed on the spot from your logs, so they need a connection. Queued writes are safe on this device."
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
      <header className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <Text as="h1" variant="title">
            Trends
          </Text>
          <SegmentedControl
            options={RANGES}
            value={vm.range}
            onChange={vm.setRange}
            label="Range"
            size="sm"
          />
        </div>
        <SegmentedControl
          options={DOMAINS}
          value={vm.domain}
          onChange={vm.setDomain}
          label="Domain"
          size="sm"
        />
      </header>

      {vm.isLoading ? (
        <SkeletonList rows={10} />
      ) : vm.domain === 'food' ? (
        <FoodPanels vm={vm} />
      ) : (
        <TrainPanels vm={vm} />
      )}
    </main>
  )
}

function FoodPanels({ vm }: { vm: ReturnType<typeof useTrends> }) {
  if (vm.foodEmpty) {
    return (
      <EmptyState
        title="NO FOOD LOGGED YET"
        body="Log a few days and these five charts fill in — calories vs target, protein streak, macro split, adherence, and how much of your data is verified."
      />
    )
  }

  return (
    <>
      <FoodReport lines={vm.reportLines} />

      <Text variant="micro">{vm.averagesCaption}</Text>

      <Panel title="Weekly average" caption={vm.foodWeeklyNote}>
        <MetricStrip metrics={vm.foodWeeklyMetrics} />
      </Panel>

      <Panel
        title="Calories vs target"
        caption="Daily intake. The shaded band is the latest phase target (gym and rest differ)."
      >
        <BandLine points={vm.kcalPoints} />
      </Panel>

      <Panel title="Protein consistency" caption={vm.proteinCaption}>
        <TickBars bars={vm.proteinTickBars} unit="g" emptyLabel="No protein logged in this range." />
      </Panel>

      <Panel
        title="Macro split"
        caption="Average grams per logged day in this range — same numbers the coach uses."
        footer={<BarLegend items={vm.macroLegend} unit="g" />}
      >
        <StackedBars bars={vm.macroBars} unit="g" decimals={0} />
      </Panel>

      <Panel
        title="Adherence"
        caption="Full accent = on calorie target. Half = logged off-band. Empty = not logged. Tick when ≥5 days on target that week."
      >
        <WeekGrid rows={vm.foodWeeks} columnLabels={vm.weekdayLabels} target={5} />
      </Panel>

      <Panel title="Data quality" caption={vm.qualityNote}>
        {vm.quality.length === 0 ? (
          <Text variant="micro">No entries to grade.</Text>
        ) : (
          <ul className="flex flex-col gap-2">
            {vm.quality.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3">
                <Text variant="body">{s.label}</Text>
                <Text variant="micro" className="tabular">
                  {`${s.count} · ${Math.round(s.pct)}%`}
                </Text>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}

function TrainPanels({ vm }: { vm: ReturnType<typeof useTrends> }) {
  if (vm.trainEmpty) {
    return (
      <EmptyState
        title="NOTHING LOGGED YET"
        body="Log a session and these charts fill themselves in. None of them is stored — every figure is recomputed from your sets each time you open this screen."
      />
    )
  }

  return (
    <>
      {vm.gymOptions.length > 1 ? (
        <Select
          label="Gym"
          value={vm.gymId ?? ''}
          onChange={vm.setGymId}
          options={vm.gymOptions}
        />
      ) : (
        <Text variant="micro">{vm.gymName}</Text>
      )}

      <Panel title="Weekly average" caption={vm.trainWeeklyNote}>
        <MetricStrip metrics={vm.trainWeeklyMetrics} />
      </Panel>

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
            ? 'Assistance needed, so DOWN is stronger. One line per gym; dashed marks a gym change.'
            : 'Estimated one-rep max from the top set (Epley). One line per gym — a cable stack marked 45 kg is not the same 45 kg at another gym. Dashed marks where a gym line begins.'
        }
      >
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
          markers={vm.lineMarkers}
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
  )
}
