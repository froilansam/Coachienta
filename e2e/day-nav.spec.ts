import { expect, test } from '@playwright/test'
import { closeDb, withDb } from './db'

/**
 * P1f: browsing days, and failing honestly when a day cannot load.
 *
 * The error tests block service workers. In a `next start` build Serwist takes
 * control and `page.route` stops intercepting, so a stubbed 500 gets passed to the
 * real server on retry and the screen renders real data — the fix looks broken
 * when it is not.
 */
const TOKEN = process.env.APP_ACCESS_TOKEN!
/** Two adjacent sentinel days, far from any real data. */
const DAY = '2019-12-20'
const NEXT_DAY = '2019-12-21'

const cleanup = () =>
  withDb(async (c) => {
    await c.query(`delete from food_log_entries where logged_on in ($1, $2)`, [DAY, NEXT_DAY])
    await c.query(`delete from nutrition_targets where phase_label like 'ZZTest%'`)
  })

test.beforeAll(cleanup)
test.afterAll(cleanup)
test.afterAll(closeDb)

// ---------------------------------------------------------------------------
// AC-1.29 — reaching a past day, and grading it against ITS targets
// ---------------------------------------------------------------------------
test('AC-1.29 — stepping back reaches a past day and its entries', async ({ page }) => {
  await page.goto(`/?k=${TOKEN}`)
  await page.getByRole('heading', { level: 1 }).waitFor()

  // Today: no forward, no TODAY jump — neither would do anything.
  await expect(page.getByRole('button', { name: 'Next day' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Today' })).toHaveCount(0)
  await expect(page.getByText('TODAY', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Previous day' }).click()
  await expect(page.getByText('YESTERDAY', { exact: true })).toBeVisible()
  // Both controls become useful the moment they can do something.
  await expect(page.getByRole('button', { name: 'Next day' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Today' })).toBeVisible()

  await page.getByRole('button', { name: 'Today' }).click()
  await expect(page.getByText('TODAY', { exact: true })).toBeVisible()
})

test('AC-1.29 — a day is graded against the targets active on THAT day', async ({ page }) => {
  /**
   * The correctness claim. Reading `effective_to is null` would judge a 2019 day
   * against 2026's targets, so a phase change would silently re-score history —
   * the same class of error as retroactive macro recalculation (§4.3).
   */
  await withDb((c) =>
    c.query(
      `insert into nutrition_targets (effective_from, effective_to, phase_label, kcal_rest_low, kcal_rest_high,
         kcal_gym_low, kcal_gym_high, protein_g, carbs_rest_low, carbs_gym_low, fat_high)
       values ($1, $2, 'ZZTest historical phase', 1111, 1111, 1111, 1111, 99, 100, 100, 33)`,
      [DAY, NEXT_DAY],
    ),
  )

  await page.goto(`/?k=${TOKEN}`)
  await page.getByLabel('Pick a day to view').fill(DAY)
  // The historical phase label proves which row was chosen.
  await expect(page.getByText('ZZTest historical phase')).toBeVisible()
  // 1,111 appears twice — as the goal and, with nothing logged, as the remainder.
  await expect(page.getByText('1,111').first()).toBeVisible()

  // One day past its window, that target must no longer apply.
  await page.getByLabel('Pick a day to view').fill('2019-12-22')
  await expect(page.getByText('ZZTest historical phase')).toBeHidden()
})

test('a day before any target says so rather than inventing a comparison', async ({ page }) => {
  await page.goto(`/?k=${TOKEN}`)
  // Long before the first nutrition_targets row.
  await page.getByLabel('Pick a day to view').fill('2019-01-01')
  await expect(page.getByText('NO TARGET FOR THIS DAY')).toBeVisible()
  await expect(page.getByText(/before your first nutrition target/)).toBeVisible()
  // And it still offers to log to that day.
  await expect(page.getByRole('button', { name: /LOG FOOD/ })).toBeVisible()
})

// ---------------------------------------------------------------------------
// AC-1.30 — logging from a past day lands on that day
// ---------------------------------------------------------------------------
test('AC-1.30 — the log sheet opens on the day being viewed', async ({ page }) => {
  await page.goto(`/?k=${TOKEN}`)
  await page.getByLabel('Pick a day to view').fill(DAY)
  await expect(page.getByText('20 DEC · FRI')).toBeVisible()

  await page.getByRole('button', { name: /LOG FOOD/ }).click()
  await page.getByLabel('Search foods').waitFor()
  // Without this the entry would silently land on today.
  await expect(page.getByLabel('Log date')).toHaveValue(DAY)
})

// ---------------------------------------------------------------------------
// AC-1.31 — a failed load is named, never rendered as an empty day
// ---------------------------------------------------------------------------
test.describe('AC-1.31 — load failures', () => {
  test.use({ serviceWorkers: 'block' })

  test('an unreachable server says so and offers a retry', async ({ page }) => {
    await page.route('**/api/data/day**', (r) => r.fulfill({ status: 500 }))
    await page.goto(`/?k=${TOKEN}`)

    await expect(page.getByText('CANNOT REACH THE SERVER')).toBeVisible()
    const body = await page.locator('main').innerText()
    // The regression: these are what an EMPTY day looks like. A failure must not
    // borrow that screen.
    expect(body).not.toContain('NOTHING LOGGED')
    expect(body).not.toContain('NO TARGET FOR THIS DAY')
  })

  test('a stale access token is named as a lockout, not as missing data', async ({ page }) => {
    // 404 is what `proxy.ts` returns to an unrecognised caller.
    await page.route('**/api/data/day**', (r) => r.fulfill({ status: 404 }))
    await page.goto(`/?k=${TOKEN}`)
    await expect(page.getByText('THIS DEVICE IS LOCKED OUT')).toBeVisible()
    await expect(page.getByText(/paste it again/)).toBeVisible()
  })

  test('retry recovers once the server answers', async ({ page }) => {
    let failing = true
    await page.route('**/api/data/day**', (r) => (failing ? r.fulfill({ status: 500 }) : r.fallback()))
    await page.goto(`/?k=${TOKEN}`)
    await expect(page.getByText('CANNOT REACH THE SERVER')).toBeVisible()

    failing = false
    await page.getByRole('button', { name: 'TRY AGAIN' }).click()
    await expect(page.getByText('CANNOT REACH THE SERVER')).toBeHidden()
  })
})

// ---------------------------------------------------------------------------
// AC-1.3 — a failed lookup is not "no match"
// ---------------------------------------------------------------------------
test.describe('AC-1.3 — lookup failure is visible', () => {
  test.use({ serviceWorkers: 'block' })

  test("a dead lookup says it didn't finish, and retries", async ({ page }) => {
    let failing = true
    await page.route('**/api/data/resolve-food', (r) =>
      failing && r.request().method() === 'POST' ? r.fulfill({ status: 500 }) : r.fallback(),
    )
    await page.goto(`/?k=${TOKEN}`)
    await page.getByRole('button', { name: /LOG FOOD/ }).click()
    await page.getByLabel('Search foods').fill('zzzz nonexistent food zzzz')

    // The failure is stated with a retry, and NO MATCH is never claimed — the
    // databases were not asked, so "not found" would be a fabricated answer.
    await expect(page.getByText(/could not be reached|Lookup failed/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'TRY AGAIN' })).toBeVisible()
    await expect(page.getByText('NO MATCH')).toHaveCount(0)

    failing = false
    await page.getByRole('button', { name: 'TRY AGAIN' }).click()
    await expect(page.getByRole('button', { name: 'TRY AGAIN' })).toBeHidden({ timeout: 15_000 })
  })

  test('a library food shows its source at the portion step', async ({ page }) => {
    await page.goto(`/?k=${TOKEN}`)
    await page.getByRole('button', { name: /LOG FOOD/ }).click()
    await page.getByLabel('Search foods').fill('white rice')
    await page.getByRole('button', { name: /White rice \(cooked\)/ }).first().click()
    await page.getByLabel(/Amount in g/).first().waitFor()

    // Collapsed, then expandable — provenance on the last screen before committing.
    const toggle = page.getByRole('button', { name: /SOURCE/ })
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(page.getByText(/spreadsheet Usual Foods/)).toBeVisible()
  })
})
