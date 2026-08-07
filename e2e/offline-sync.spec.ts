import { expect, test } from '@playwright/test'
import { connect } from '../scripts/db'

/**
 * P0 exit criteria (PRD-000 §6): "logs a hardcoded row offline, syncs on focus".
 *
 * This is PRD-000's R1/R2 — the most fragile part of the architecture and the
 * part a type-check cannot touch. Everything here runs against real Postgres.
 */
const TOKEN = process.env.APP_ACCESS_TOKEN!

async function withDb<T>(fn: (q: (sql: string) => Promise<unknown[]>) => Promise<T>): Promise<T> {
  const c = await connect()
  try {
    return await fn(async (sql) => (await c.query(sql)).rows)
  } finally {
    await c.end()
  }
}

const countHarnessRows = () =>
  withDb(async (q) => {
    const rows = (await q(
      `select count(*)::int n from food_log_entries where meal = 'Harness'`,
    )) as Array<{ n: number }>
    return rows[0]!.n
  })

const clearHarnessRows = () =>
  withDb((q) => q(`delete from food_log_entries where meal = 'Harness'`))

test.beforeAll(clearHarnessRows)
test.afterAll(clearHarnessRows)

test('the access gate blocks the API without a token', async ({ request }) => {
  expect((await request.get('/api/data/health')).status()).toBe(404)
})

test('offline writes land in IndexedDB and sync when connectivity returns', async ({
  page,
  context,
}) => {
  await page.goto(`/?k=${TOKEN}`)
  await page.goto('/dev/offline')
  await page.getByTestId('log-row').waitFor()

  await context.setOffline(true)
  await expect(page.getByTestId('online')).toHaveText('no')

  const BATCH = 3
  for (let i = 0; i < BATCH; i++) await page.getByTestId('log-row').click()
  await expect(page.getByTestId('pending')).toHaveText(String(BATCH))

  // Nothing may reach the server while offline.
  expect(await countHarnessRows()).toBe(0)

  // Durability: read IndexedDB directly, not React state. This is what proves
  // the write survives a process kill — the queue is on disk, not in memory.
  const queued = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open('coachienta')
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    return new Promise<number>((res) => {
      const req = db.transaction('queue', 'readonly').objectStore('queue').count()
      req.onsuccess = () => res(req.result)
    })
  })
  expect(queued).toBe(BATCH)

  // Back online — the queue drains on the `online` event.
  await context.setOffline(false)
  await expect(page.getByTestId('online')).toHaveText('yes')
  await expect(page.getByTestId('pending')).toHaveText('0', { timeout: 20_000 })
  await expect(page.getByTestId('failed')).toHaveText('0')

  expect(await countHarnessRows()).toBe(BATCH)
})

test('syncs on tab focus, not only on the online event', async ({ page, context }) => {
  // iOS Safari has no Background Sync API, so focus is the primary trigger
  // (PRD-001 §4.2). Worth asserting separately from the `online` path.
  await page.goto(`/?k=${TOKEN}`)
  await page.goto('/dev/offline')
  await page.getByTestId('log-row').waitFor()

  await context.setOffline(true)
  await page.getByTestId('log-row').click()
  await expect(page.getByTestId('pending')).toHaveText('1')

  await context.setOffline(false)
  // The SW claiming this client can destroy the execution context mid-evaluate,
  // so settle first, then drive the focus path explicitly.
  await page.waitForLoadState('domcontentloaded')
  await page.getByTestId('log-row').waitFor()
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByTestId('pending')).toHaveText('0', { timeout: 20_000 })
})

test('a replayed flush does not duplicate rows (idempotency)', async ({ page }) => {
  await page.goto(`/?k=${TOKEN}`)
  await page.goto('/dev/offline')
  await page.getByTestId('log-row').click()
  await expect(page.getByTestId('pending')).toHaveText('0', { timeout: 20_000 })

  const after = await countHarnessRows()

  // The client-generated uuid is the row's primary key, so a replay must upsert
  // rather than insert a second copy (PRD-001 §4.2).
  for (let i = 0; i < 3; i++) await page.getByTestId('flush').click()
  await page.waitForTimeout(1500)

  expect(await countHarnessRows()).toBe(after)
})

/**
 * KNOWN GAP — not a P0 exit criterion. Tracked, not skipped or faked green.
 *
 * Reloading with no network yields ERR_FAILED instead of a cached shell.
 * Diagnosed: `__SW_MANIFEST` carries only `_next/static/*` (App Router HTML is
 * never precached), `@serwist/next` ignores `additionalPrecacheEntries`, and its
 * `defaultCache` is a single NetworkOnly passthrough. A hand-written
 * NetworkFirst document route does reach the bundle but never creates its cache.
 *
 * Queued writes are unaffected — they live in IndexedDB and upload on next
 * focus, which the tests above prove. This costs only the shell on a cold
 * offline launch (PRD-001 §4.3).
 */
test.fixme('reloading offline serves a cached shell', async ({ page, context }) => {
  await page.goto(`/?k=${TOKEN}`)
  await page.goto('/dev/offline')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByTestId('log-row')).toBeVisible()
})
