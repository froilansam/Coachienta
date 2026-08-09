import { expect, test, type Page } from '@playwright/test'
import { closeDb, withDb } from './db'

/**
 * P1c: Today screen + tab bar.
 *
 * AC-1.7 is the important one — displayed totals must equal `SUM` over
 * `food_log_entries`. That reconciliation failing is precisely what made the
 * spreadsheet's dashboard show 0 kcal while Food Logs held 980 rows.
 *
 * ## Everything that seeds happens on a SENTINEL day, never the real one
 *
 * This file used to `delete from food_log_entries where logged_on = <today>` in both
 * `beforeAll` and `afterAll`, so a test run silently wiped whatever had actually been
 * eaten that day. Seeding 2019 and reaching it with the date picker (AC-1.29) makes the
 * cleanup safe by construction: there is nothing real on that day to lose.
 *
 * Only AC-1.8 stays on the real today, because "the ACTIVE targets row" is the claim it
 * makes — and it reads, never writes.
 */
const TOKEN = process.env.APP_ACCESS_TOKEN!

const DAY = '2019-12-18'
const HEADING = '18 DEC · WED'
const PHASE = 'ZZTest today-spec phase'

/** Seed known entries straight into Postgres so the assertions have exact maths. */
async function seedDay() {
  await withDb(async (c) => {
    await c.query(`delete from food_log_entries where logged_on = $1`, [DAY])
    await c.query(`delete from nutrition_targets where phase_label = $1`, [PHASE])
    // A one-day window, so the StatRow sentences carry a target and nothing else moves.
    await c.query(
      `insert into nutrition_targets (effective_from, effective_to, phase_label,
         kcal_rest_low, kcal_rest_high, kcal_gym_low, kcal_gym_high,
         protein_g, carbs_rest_low, carbs_gym_low, fat_high)
       values ($1, $1, $2, 2000, 2000, 2000, 2000, 160, 150, 150, 60)`,
      [DAY, PHASE],
    )
    await c.query(
      `insert into food_log_entries
        (id, logged_on, meal, food_name, amount, unit, kcal, protein_g, carbs_g, fat_g, confidence, resolved_by, food_version)
       values
        (gen_random_uuid(), $1, 'Breakfast', 'Scrambled eggs', 3,   'piece', 216, 18.9,  1.2, 15.0, 'high',   'library', null),
        (gen_random_uuid(), $1, 'Breakfast', 'White rice',     200, 'g',     252,  4.6, 56.4,  0.4, 'high',   'library', null),
        (gen_random_uuid(), $1, 'Lunch',     'Chicken breast', 100, 'g',     193, 36.3,  0.0,  4.2, 'medium', 'library', null),
        (gen_random_uuid(), $1, 'Dinner',    'ZZTest yogurt',  170, 'g',     100, 17.3,  6.1,  0.4, 'high',   'usda',    2)`,
      [DAY],
    )
  })
}

const dbTotals = () =>
  withDb(async (c) => {
    const r = await c.query<{ kcal: string; p: string; ch: string; f: string; n: string }>(
      `select coalesce(sum(kcal),0) kcal, coalesce(sum(protein_g),0) p,
              coalesce(sum(carbs_g),0) ch, coalesce(sum(fat_g),0) f, count(*) n
         from food_log_entries where logged_on = $1`,
      [DAY],
    )
    const x = r.rows[0]!
    return { kcal: Number(x.kcal), p: Number(x.p), ch: Number(x.ch), f: Number(x.f), n: Number(x.n) }
  })

const countOnDay = (name: string) =>
  withDb(async (c) => {
    const r = await c.query<{ n: string }>(
      `select count(*) n from food_log_entries where logged_on = $1 and food_name = $2`,
      [DAY, name],
    )
    return Number(r.rows[0]!.n)
  })

/** Unlock, then jump straight to the sentinel day rather than stepping ~2,400 times. */
async function openDay(page: Page) {
  await page.goto(`/?k=${TOKEN}`)
  await page.getByLabel('Pick a day to view').fill(DAY)
  await expect(page.getByText(HEADING)).toBeVisible()
}

const cleanup = () =>
  withDb(async (c) => {
    await c.query(`delete from food_log_entries where logged_on = $1`, [DAY])
    await c.query(`delete from nutrition_targets where phase_label = $1`, [PHASE])
  })

test.beforeAll(seedDay)
test.afterAll(cleanup)
test.afterAll(closeDb)

test('root redirects to Today and the tab bar is present', async ({ page }) => {
  await page.goto(`/?k=${TOKEN}`)
  await expect(page).toHaveURL(/\/today$/)
  const nav = page.getByRole('navigation', { name: 'Main' })
  for (const label of ['Today', 'Train', 'Coach', 'More']) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible()
  }
  // Today is marked current; food logging is deliberately not a tab.
  await expect(nav.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link', { name: 'Food' })).toHaveCount(0)
})

test('AC-1.7 — displayed totals equal SUM over the day rows', async ({ page }) => {
  await openDay(page)

  const db = await dbTotals()
  expect(db.n).toBe(4)

  /**
   * Assert on the StatRow screen-reader sentence. It is one deterministic string
   * per macro — "PRO, 59.8 g, 170.2 below target, target 230" — rather than a
   * loose number match that could pick up any digit on the page.
   */
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: n >= 1000 ? 0 : 1 })
  for (const [label, value] of [['PRO', db.p], ['CHO', db.ch], ['FAT', db.f]] as const) {
    await expect(
      page.getByText(new RegExp(`^${label}, ${fmt(value).replace('.', '\\.')} g,`)),
    ).toBeVisible()
  }

  // Calories appear as the FOOD term of the visible equation.
  await expect(page.getByText('FOOD', { exact: true })).toBeVisible()
  await expect(page.getByText(fmt(db.kcal), { exact: true }).first()).toBeVisible()
})

test('AC-1.8 — targets come from the active nutrition_targets row', async ({ page }) => {
  await page.goto(`/?k=${TOKEN}`)
  await page.goto('/today')

  const phase = await withDb(async (c) => {
    const r = await c.query<{ phase_label: string; protein_g: number }>(
      `select phase_label, protein_g from nutrition_targets where effective_to is null`,
    )
    return r.rows[0]!
  })

  await expect(page.getByText(phase.phase_label)).toBeVisible()
  // Rendered from the DB row, not a constant — the sentence carries the target.
  await expect(page.getByText(new RegExp(`^PRO,.*target ${phase.protein_g}$`))).toBeVisible()
})

test('entries are grouped by meal with a subtotal per meal', async ({ page }) => {
  await openDay(page)

  await expect(page.getByText('Breakfast', { exact: true })).toBeVisible()
  await expect(page.getByText('Lunch', { exact: true })).toBeVisible()

  // Breakfast = 216 + 252 = 468
  await expect(page.getByText('468', { exact: true })).toBeVisible()
  await expect(page.getByText('Scrambled eggs')).toBeVisible()
  await expect(page.getByText('Chicken breast')).toBeVisible()
})

test('deleting an entry removes it and the totals follow', async ({ page }) => {
  await openDay(page)
  await expect(page.getByText('Chicken breast')).toBeVisible()

  /**
   * Swipe actions live in the DOM permanently and are only translated out of
   * view, so they stay focusable and announced. Driving them by keyboard is the
   * accessibility contract — "reachable without swiping" (PRD-007 §3.16) — and a
   * pointer click cannot work here because the row overlays them.
   */
  const del = page.getByRole('button', { name: 'Delete Chicken breast' })
  await del.focus()
  await page.keyboard.press('Enter')

  await expect.poll(async () => (await dbTotals()).n, { timeout: 20_000 }).toBe(3)
  await expect(page.getByText('Chicken breast')).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// Tapping a logged entry opens it in full
// ---------------------------------------------------------------------------
test('tapping an entry shows the macros AS LOGGED and where they came from', async ({ page }) => {
  await openDay(page)

  await page.getByRole('button', { name: /^ZZTest yogurt/ }).click()
  await expect(page.getByRole('heading', { name: 'Logged entry' })).toBeVisible()

  // The entry's own macros, not the day's — the day totals carry a target clause,
  // so an exact end-anchored sentence can only be the sheet's.
  await expect(page.getByText('PRO, 17.3 g', { exact: true })).toBeVisible()
  await expect(page.getByText('CHO, 6.1 g', { exact: true })).toBeVisible()
  await expect(page.getByText('FAT, 0.4 g', { exact: true })).toBeVisible()

  // Provenance, from `resolved_by` + `food_version` rather than a guess.
  await expect(page.getByText('USDA', { exact: true })).toBeVisible()
  await expect(page.getByText('USDA FoodData Central · food v2')).toBeVisible()

  /**
   * Read-only by design: a log entry is a frozen measurement (AC-1.6), so the sheet
   * offers delete and says why it offers nothing else. If an edit control ever
   * appears here, either that guarantee broke or the sheet started lying about it.
   */
  await expect(page.getByRole('button', { name: /DELETE ENTRY/ })).toBeVisible()
  await expect(page.getByText(/to fix it, delete it and log it again/)).toBeVisible()
})

test('deleting from the detail sheet removes the entry', async ({ page }) => {
  await openDay(page)

  await page.getByRole('button', { name: /^ZZTest yogurt/ }).click()
  await page.getByRole('button', { name: /DELETE ENTRY/ }).click()

  await expect.poll(() => countOnDay('ZZTest yogurt'), { timeout: 20_000 }).toBe(0)
  await expect(page.getByText('ZZTest yogurt')).toHaveCount(0)
})

test('an offline log appears on Today immediately', async ({ page, context }) => {
  await openDay(page)

  await context.setOffline(true)
  await page.getByRole('button', { name: /LOG FOOD/ }).first().click()
  await page.getByRole('button', { name: /White rice \(cooked\)/ }).first().click()
  await page.getByRole('button', { name: 'ADD' }).click()
  await page.getByRole('button', { name: /LOG 1 ITEM/ }).click()

  // Rendered from IndexedDB, before any upload.
  await expect(page.getByText('Pending').first()).toBeVisible()

  // Drain before finishing. Otherwise the flush lands AFTER afterAll's delete and
  // the row survives into the next run — which is exactly what happened.
  await context.setOffline(false)
  await expect.poll(() => countOnDay('White rice (cooked)'), { timeout: 20_000 }).toBe(1)
})

test('a toast does not block the tab bar (regression)', async ({ page }) => {
  await openDay(page)

  // Log something so a toast fires.
  await page.getByRole('button', { name: /LOG FOOD/ }).first().click()
  await page.getByRole('button', { name: /White rice \(cooked\)/ }).first().click()
  await page.getByRole('button', { name: 'ADD' }).click()
  await page.getByRole('button', { name: /LOG 1 ITEM/ }).click()
  await expect(page.getByText('Logged 1 item', { exact: true })).toBeVisible()

  /**
   * The toast viewport used to be pinned to bottom-0 at z-50, full width — it
   * covered the tab bar, so for the 4 s a toast was alive navigation was dead.
   * `elementFromPoint` on a tab returned the toast's own <ol>.
   */
  const nav = page.getByRole('navigation', { name: 'Main' })
  for (const label of ['Train', 'Coach', 'More']) {
    await nav.getByRole('link', { name: label }).click({ timeout: 4000 })
    await expect(page).toHaveURL(new RegExp(`/${label.toLowerCase()}$`))
  }

  // Drain, for the same reason as the offline test above.
  await expect.poll(() => countOnDay('White rice (cooked)'), { timeout: 20_000 }).toBeGreaterThan(0)
})
