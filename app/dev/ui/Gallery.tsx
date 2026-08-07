'use client'
import { Flame, Plus } from 'lucide-react'
import { useState } from 'react'
import { DeltaBadge } from '@/components/patterns/DeltaBadge'
import { EquationRow } from '@/components/patterns/EquationRow'
import { KeypadSheet } from '@/components/patterns/KeypadSheet'
import { MetricStrip } from '@/components/patterns/MetricStrip'
import { NumericTable } from '@/components/patterns/NumericTable'
import { PrStamp } from '@/components/patterns/PrStamp'
import { StatRow } from '@/components/patterns/StatRow'
import { SyncBadge } from '@/components/patterns/SyncBadge'
import { Button, IconButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Checkbox } from '@/components/ui/Checkbox'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field, Input } from '@/components/ui/Field'
import { ListRow } from '@/components/ui/ListRow'
import { NumericInput } from '@/components/ui/NumericInput'
import { NumericValue } from '@/components/ui/NumericValue'
import { ProgressTrack } from '@/components/ui/ProgressTrack'
import { Rule } from '@/components/ui/Rule'
import { SearchField } from '@/components/ui/SearchField'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { SkeletonList } from '@/components/ui/Skeleton'
import { Spinner } from '@/components/ui/Spinner'
import { Stack } from '@/components/ui/Stack'
import { Stepper } from '@/components/ui/Stepper'
import { TabPanel, Tabs } from '@/components/ui/Tabs'
import { Text } from '@/components/ui/Text'
import { useToast } from '@/components/ui/Toast'
import { Toggle } from '@/components/ui/Toggle'

/** Fixture for NumericTable — mirrors a real live-session exercise. */
const SETS = [
  { id: 'w', set: 'W', prev: '—', kg: 6, reps: 15, done: true },
  { id: '1', set: '1', prev: '10 × 13', kg: 10, reps: 13, done: true },
  { id: '2', set: '2', prev: '10 × 12', kg: 10, reps: 12, done: false },
  { id: '3', set: '3', prev: '10 × 10', kg: 10, reps: null, done: false },
] as const

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <Text variant="label">{title}</Text>
      <Rule />
      <div className="flex flex-col gap-3 pt-1">{children}</div>
    </section>
  )
}

export function Gallery() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [grams, setGrams] = useState<number | null>(200)
  const [reps, setReps] = useState<number | null>(null)
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('7d')
  const [basis, setBasis] = useState<'serving' | 'g' | 'ml'>('g')
  const [done, setDone] = useState([true, true, false, false])
  const [notify, setNotify] = useState(true)
  const [sheet, setSheet] = useState(false)
  const [keypad, setKeypad] = useState(false)
  const [pad, setPad] = useState('10')
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'az' | 'muscle' | 'recent'>('az')
  const [pr, setPr] = useState(0)
  const toast = useToast()

  const applyTheme = (t: 'light' | 'dark') => {
    setTheme(t)
    document.documentElement.dataset.theme = t
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-12 px-4 py-8">
      <header className="flex items-center justify-between gap-4">
        <Text as="h1" variant="title">
          UI Gallery
        </Text>
        <SegmentedControl
          label="Theme"
          size="sm"
          value={theme}
          onChange={applyTheme}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </header>

      <Block title="Typography">
        <Text variant="title">Title · 20/600 · tight tracking</Text>
        <Text variant="label">Section label · 11/600 · uppercase +0.08em</Text>
        <Text variant="body">Body · 16/400 · the reading size.</Text>
        <Text variant="meta">Meta · 14/400 · secondary tone.</Text>
        <Text variant="micro">Micro · 11/500 · tertiary tone.</Text>
        <Text variant="body" lang="ja">
          直火炙り焼豚チャーハン — Japanese food names carry lang=&quot;ja&quot;
        </Text>
      </Block>

      <Block title="Numerals — tabular, right-aligned">
        <div className="flex items-baseline gap-4">
          <NumericValue value={2090} size="metric" />
          <NumericValue value={168.3} unit="g" />
          <NumericValue value={-93.3} showSign tone="neg" />
          <NumericValue value={null} />
        </div>
        <Text variant="micro">null renders — never 0. A missing weigh-in is not 0 kg.</Text>
        <div className="w-36 font-mono">
          {[1111.1, 2090, 88.8, 100000].map((n) => (
            <div key={n} className="text-right">
              <NumericValue value={n} />
            </div>
          ))}
        </div>
        <Text variant="micro">Digits share a width, so the column edge stays straight.</Text>
      </Block>

      <Block title="StatRow — the signature component">
        <StatRow label="PRO" value={168.3} unit="g" target={160} delta={{ value: 8.3, direction: 'up', state: 'good' }} />
        <StatRow label="CHO" value={196.7} unit="g" target={290} delta={{ value: -93.3, direction: 'down', state: 'bad' }} />
        <StatRow label="FAT" value={70.4} unit="g" target={75} delta={{ value: 0, direction: 'flat', state: 'good' }} />
        <StatRow label="FIBRE" value={null} unit="g" target={30} chip={{ label: 'EST', tone: 'warn' }} />
      </Block>

      <Block title="DeltaBadge — emphasis levels">
        <div className="flex flex-wrap items-center gap-3">
          <DeltaBadge value={8.3} unit="g" direction="up" state="good" emphasis="wash" />
          <DeltaBadge value={-93.3} unit="g" direction="down" state="bad" emphasis="wash" />
          <DeltaBadge value={8.3} unit="g" direction="up" state="good" />
          <DeltaBadge value={0} direction="flat" state="good" />
        </div>
        <Text variant="micro">
          Tinted pill = primary (Bloomberg % CHANGE). Plain text = secondary (NET CHG).
        </Text>
      </Block>

      <Block title="EquationRow / MetricStrip">
        <EquationRow
          terms={[
            { label: 'GOAL', value: 2350 },
            { label: 'FOOD', value: 2090, operator: '−' },
            { label: 'REMAINING', value: 260, operator: '=' },
          ]}
        />
        <MetricStrip
          metrics={[
            { label: 'DURATION', value: null, display: '42:18' },
            { label: 'VOLUME', value: 4180, unit: 'kg' },
            { label: 'SETS', value: 14 },
          ]}
        />
      </Block>

      <Block title="ProgressTrack">
        <ProgressTrack pct={89} label="Calories 89%" />
        <ProgressTrack pct={100} tone="pos" label="Protein met" />
        <ProgressTrack pct={112} tone="warn" label="Over target" />
        <Text variant="micro">112% shows an overflow marker instead of clamping to a full bar.</Text>
      </Block>

      <Block title="Buttons — one primary per screen">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" iconStart={Plus}>LOG</Button>
          <Button variant="secondary">＋ ADD SET</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Discard workout</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" loading>LOG</Button>
          <Button variant="primary" disabled>Disabled</Button>
          <Button variant="secondary" size="sm">Small</Button>
          <IconButton icon={Plus} label="Add" />
        </div>
        <Text variant="micro">Destructive is text-only; solid red belongs on the confirm step.</Text>
      </Block>

      <Block title="Chips">
        <div className="flex flex-wrap items-center gap-2">
          <Chip label="PR" tone="accent" icon={Flame} />
          <Chip label="EST" tone="warn" />
          <Chip label="UNVERIFIED" tone="warn" />
          <Chip label="VERIFIED" tone="pos" />
          <Chip label="NEW GYM" tone="neutral" />
          <Chip label="White rice 200 g" onRemove={() => {}} />
        </div>
      </Block>

      <Block title="Inputs">
        <Field label="Food name" hint="Search your library first">
          <Input placeholder="e.g. white rice" />
        </Field>
        <Field label="Food name" error="That doesn't look like a food">
          <Input defaultValue="nutrition planning session" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Weight" labelHidden>
            <NumericInput value={reps} onChange={setReps} unit="kg" placeholder="10" aria-label="Weight" />
          </Field>
          <Field label="Reps" labelHidden>
            <NumericInput value={reps} onChange={setReps} placeholder="13" aria-label="Reps" />
          </Field>
        </div>
        <Text variant="micro">
          Placeholder shows last session&apos;s value. 16px minimum, or iOS zooms on focus.
        </Text>
      </Block>

      <Block title="Stepper — presets are the detail that matters">
        <Stepper
          label="Amount"
          value={grams}
          onChange={setGrams}
          unit="g"
          step={10}
          presets={[100, 150, 200, 250]}
        />
      </Block>

      <Block title="Segmented controls">
        <SegmentedControl
          label="Range"
          value={range}
          onChange={setRange}
          options={[
            { value: '7d', label: '7d' },
            { value: '30d', label: '30d' },
            { value: '90d', label: '90d' },
          ]}
        />
        <SegmentedControl
          label="Basis"
          fullWidth
          value={basis}
          onChange={setBasis}
          options={[
            { value: 'serving', label: 'Serving' },
            { value: 'g', label: '100 g' },
            { value: 'ml', label: '100 ml' },
          ]}
        />
        <Text variant="micro">Basis toggle maps 1:1 onto the basis_unit enum (MacroFactor pattern).</Text>
      </Block>

      <Block title="Checkbox — commit variant is the set-complete control">
        <div className="flex items-center gap-4">
          {done.map((d, i) => (
            <Checkbox
              key={i}
              variant="commit"
              checked={d}
              label={`Set ${i + 1} complete`}
              onCheckedChange={(v) => setDone(done.map((x, j) => (j === i ? v : x)))}
            />
          ))}
          <Checkbox checked label="Default size" onCheckedChange={() => {}} />
        </div>
        <Toggle checked={notify} onCheckedChange={setNotify} label="Rest timer" hint="Auto-start on set commit" />
      </Block>

      <Block title="ListRow — left bar encodes direction by position">
        <Card padding="none">
          <ListRow title="Scrambled eggs" subtitle="3 eggs · 07:40" meta={<NumericValue value={216} />} />
          <Rule inset />
          <ListRow title="White rice (cooked)" subtitle="200 g · 07:40" meta={<NumericValue value={252} />} zebra />
          <Rule inset />
          <ListRow
            title="Chicken breast"
            subtitle="100 g · 12:15"
            barTone="pos"
            meta={<div className="flex items-center gap-2"><Chip label="EST" tone="warn" size="sm" /><NumericValue value={193} /></div>}
          />
        </Card>
      </Block>

      <Block title="EmptyState — teaches, doesn't apologise">
        <EmptyState
          title="No entries"
          body="Log your first meal. Your 279 imported foods are already searchable — most take two taps."
          action={<Button variant="primary" iconStart={Plus}>Log food</Button>}
        />
      </Block>

      <Block title="Sheet — the primary input surface">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setSheet(true)}>
            Open log sheet
          </Button>
          <Button variant="secondary" onClick={() => setKeypad(true)}>
            Open keypad
          </Button>
        </div>
        <Text variant="micro">
          Header carries editable date / time / meal chips, so retroactive logging is one tap.
        </Text>
      </Block>

      <Block title="SearchField — debounced, never auto-submits">
        <SearchField label="Search foods" value={query} onChange={setQuery} placeholder="e.g. white rice" />
        <Text variant="micro">
          350 ms debounce. Open Food Facts allows 10 searches/min and warns against search-as-you-type.
        </Text>
      </Block>

      <Block title="NumericTable — committed rows fill, not shadow">
        <NumericTable
          caption="Lateral raise sets"
          rowKey={(r) => r.id}
          rowState={(r) => (r.done ? 'committed' : 'default')}
          rows={SETS}
          columns={[
            { key: 'set', header: 'SET', width: 'min', render: (r) => <Text variant="label">{r.set}</Text> },
            { key: 'prev', header: 'PREV', render: (r) => <span className="tabular font-mono text-sm text-ink-3">{r.prev}</span> },
            { key: 'kg', header: 'KG', align: 'end', render: (r) => <NumericValue value={r.kg} /> },
            { key: 'reps', header: 'REPS', align: 'end', render: (r) => <NumericValue value={r.reps} decimals={0} /> },
            {
              key: 'done',
              header: '✓',
              align: 'end',
              width: 'min',
              render: (r) => (
                <Checkbox
                  variant="commit"
                  checked={r.done}
                  label={`Set ${r.set} complete`}
                  onCheckedChange={() => {}}
                />
              ),
            },
          ]}
        />
        <Text variant="micro">
          PREV is never hidden — it&apos;s what makes progression decidable mid-set.
        </Text>
      </Block>

      <Block title="Tabs — underline, not pills">
        <Tabs
          label="Library"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'az', label: 'A–Z' },
            { value: 'muscle', label: 'Muscle group' },
            { value: 'recent', label: 'Recent' },
          ]}
        >
          <TabPanel value="az"><Text variant="meta">Alphabetical listing…</Text></TabPanel>
          <TabPanel value="muscle"><Text variant="meta">Grouped by muscle group…</Text></TabPanel>
          <TabPanel value="recent"><Text variant="meta">Most-logged first…</Text></TabPanel>
        </Tabs>
      </Block>

      <Block title="SyncBadge — unsynced work is never invisible">
        <div className="flex flex-wrap items-center gap-3">
          <SyncBadge online={false} pending={3} failed={0} />
          <SyncBadge online pending={2} failed={0} />
          <SyncBadge online pending={0} failed={1} onRetry={() => {}} />
          <Text variant="micro">(synced + online renders nothing)</Text>
        </div>
      </Block>

      <Block title="Skeleton — never a spinner for content">
        <SkeletonList rows={3} />
        <div className="flex items-center gap-2">
          <Spinner />
          <Text variant="micro">Spinner is for buttons and indeterminate waits only.</Text>
        </div>
      </Block>

      <Block title="Toast + delight">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => toast({ message: 'Logged 200 g white rice' })}>
            Toast
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast({ message: 'Entry deleted', tone: 'neg', action: { label: 'Undo', onAction: () => {} } })}
          >
            Toast + Undo
          </Button>
          <Button variant="secondary" onClick={() => setPr(pr + 1)}>
            Replay PR stamp
          </Button>
          <PrStamp stampKey={pr} />
        </div>
        <Text variant="micro">
          A mechanical press, not confetti. No streaks, no badges, no celebratory sound.
        </Text>
      </Block>

      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="Log food"
        headerSlot={
          <>
            <Chip label="06 AUG" />
            <Chip label="15:20" />
            <Chip label="Snack" />
          </>
        }
        footer={
          <Button variant="primary" size="lg" fullWidth onClick={() => setSheet(false)}>
            LOG 2 ITEMS
          </Button>
        }
      >
        <Stack gap={4} className="pb-4">
          <SearchField label="Search foods" value={query} onChange={setQuery} placeholder="e.g. white rice" />
          <Stepper label="Amount" value={grams} onChange={setGrams} unit="g" presets={[100, 150, 200, 250]} />
          <Rule />
          <div className="flex flex-wrap gap-1.5">
            <Chip label="White rice 200 g" onRemove={() => {}} />
            <Chip label="Kimchi 60 g" onRemove={() => {}} />
          </div>
          <EquationRow
            terms={[
              { label: 'KCAL', value: 268 },
              { label: 'P', value: 3.5, operator: '+' },
              { label: 'C', value: 59.2, operator: '+' },
            ]}
          />
        </Stack>
      </Sheet>

      <KeypadSheet
        open={keypad}
        onOpenChange={setKeypad}
        label="Weight"
        unit="kg"
        value={pad}
        onChange={setPad}
        onDone={() => setKeypad(false)}
      />

      <Stack gap={2} className="pb-safe">
        <Rule strong />
        <Text variant="micro">
          Toggle the theme above and re-check every block. Both themes ship, and
          data-theme must win over the OS preference in both directions.
        </Text>
      </Stack>
    </main>
  )
}
