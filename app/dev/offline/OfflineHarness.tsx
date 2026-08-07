'use client'
import { useLiveQuery } from 'dexie-react-hooks'
import { useOnline } from '@/hooks/useOnline'
import { NumericValue } from '@/components/ui/NumericValue'
import { Button } from '@/components/ui/Button'
import { Rule } from '@/components/ui/Rule'
import { Stack } from '@/components/ui/Stack'
import { Text } from '@/components/ui/Text'
import { SyncBadge } from '@/components/patterns/SyncBadge'
import { local } from '@/lib/offline/db'
import { enqueue, failedCount, flush, pendingCount } from '@/lib/offline/sync'

/**
 * Exercises the real offline write path end to end — the P0 exit criterion
 * ("logs a hardcoded row offline, syncs on focus"). This is a dev harness, not
 * a product screen: it calls the same `enqueue()` that Feature 1 will.
 */
export function OfflineHarness() {
  const online = useOnline()

  // `useLiveQuery` re-runs on any Dexie write, so the harness needs no polling —
  // and the E2E tests see the new state on the same tick the queue changes.
  const pending = useLiveQuery(pendingCount, [], 0)
  const failed = useLiveQuery(failedCount, [], 0)
  const rows =
    useLiveQuery(
      async () =>
        (await local.rows.toArray())
          .slice(-8)
          .map((r) => ({ id: r.id, day: r.day, state: r.state })),
      [],
      [],
    ) ?? []

  const logRow = async () => {
    const id = crypto.randomUUID()
    const day = new Date().toISOString().slice(0, 10)
    await enqueue(
      {
        id,
        table: 'food_log_entries',
        op: 'insert',
        payload: {
          logged_on: day,
          meal: 'Harness',
          food_name: 'White rice (cooked)',
          amount: 200,
          unit: 'g',
          kcal: 252,
          protein_g: 4.6,
          carbs_g: 56.4,
          fat_g: 0.4,
          confidence: 'high',
          resolved_by: 'library',
        },
      },
      { day, data: { food_name: 'White rice (cooked)', kcal: 252 } },
    )
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <Text as="h1" variant="title">
          Offline harness
        </Text>
        <SyncBadge online={online} pending={pending} failed={failed} onRetry={() => void flush()} />
      </div>

      <Text variant="meta">
        Writes go to IndexedDB first and upload separately. Switch the network off in
        DevTools, log a few rows, then switch it back on — the queue drains on the{' '}
        <code>online</code> event and on every tab focus.
      </Text>

      <Rule />

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={logRow} data-testid="log-row">
          Log a row
        </Button>
        <Button variant="secondary" onClick={() => void flush()} data-testid="flush">
          Flush now
        </Button>
        <Button
          variant="danger"
          onClick={async () => {
            await local.queue.clear()
            await local.rows.clear()
          }}
        >
          Clear local
        </Button>
      </div>

      <Rule />

      <dl className="flex gap-6">
        <div className="flex items-baseline gap-1.5">
          <dt><Text variant="label">ONLINE</Text></dt>
          <dd data-testid="online">
            <Text variant="body">{online ? 'yes' : 'no'}</Text>
          </dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt><Text variant="label">PENDING</Text></dt>
          <dd data-testid="pending"><NumericValue value={pending} decimals={0} /></dd>
        </div>
        <div className="flex items-baseline gap-1.5">
          <dt><Text variant="label">FAILED</Text></dt>
          <dd data-testid="failed"><NumericValue value={failed} decimals={0} /></dd>
        </div>
      </dl>

      <Stack gap={0}>
        <Text variant="label">LOCAL MIRROR</Text>
        {rows.length === 0 ? (
          <Text variant="micro">empty</Text>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-1">
              <Text variant="micro" className="w-24 font-mono">
                {r.id.slice(0, 8)}
              </Text>
              <Text variant="micro">{r.day}</Text>
              <Text variant="micro" tone={r.state === 'synced' ? 'pos' : 'warn'}>
                {r.state}
              </Text>
            </div>
          ))
        )}
      </Stack>
    </main>
  )
}
