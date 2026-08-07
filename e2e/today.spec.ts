import { expect, test } from '@playwright/test'
import { closeDb, withDb } from './db'

/**
 * P1c: Today screen + tab bar.
 *
 * AC-1.7 is the important one — displayed totals must equal `SUM` over
 * `food_log_entries`. That reconciliation failing is precisely what made the
 * spreadsheet's dashboard show 0 kcal while Food Logs held 980 rows.
 */
const TOKEN = process.env.APP_ACCESS_TOKEN!

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DAY = today()

/** Seed known entries straight into Postgres so the assertions have exact maths. */
async function seedDay() {
  await withDb(async (c) => {
    await c.query(`delete from food_log_entries where logged_on = $1`, [DAY])
    await c.query(
      `insert into food_log_entries
        (id, logged_on, meal, food_name, amount, unit, kcal, protein_g, carbs_g, fat_g, confidence, resolved_by)
       values
        (gen_random_uuid(), $1, 'Breakfast', 'Scrambled eggs', 3,   'piece', 216, 18.9, 1.2, 15.0, 'high',   'library'),
        (gen_random_uuid(), $1, 'Breakfast', 'White rice',     200, 'g',     252,  4.6, 56.4, 0.4, 'high',   'library'),
        (gen_random_uuid(), $1, 'Lunch',     'Chicken breast', 100, 'g',     193, 36.3,  0.0, 4.2, 'medium', 'library')`,
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

test.beforeAll(seedDay)
test.afterAll(closeDb)
test.afterAll(() =>
  withDb((c) => c.query(`delete from food_log_entries where logged_on = $1`, [DAY])),
)

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
  await page.goto(`/?k=${TOKEN}`)
  await page.goto('/today')
  await page.getByRole('navigation', { name: 'Main' }).waitFor()

  const db = await dbTotals()
  expect(db.n).toBe(3)

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
  await page.goto(`/?k=${TOKEN}`)
  await page.goto('/today')

  await expect(page.getByText('Breakfast', { exact: true })).toBeVisible()
  await expect(page.getByText('Lunch', { exact: true })).toBeVisible()

  // Breakfast = 216 + 252 = 468
  await expect(page.getByText('468', { exact: true })).toBeVisible()
  await expect(page.getByText('Scrambled eggs')).toBeVisible()
  await expect(page.getByText('Chicken breast')).toBeVisible()
})

test('deleting an entry removes it and the totals follow', async ({ page }) => {
  await page.goto(`/?k=${TOKEN}`)
  await page.goto('/today')
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

  await expect.poll(async () => (await dbTotals()).n, { timeout: 20_000 }).toBe(2)
  await expect(page.getByText('Chicken breast')).toHaveCount(0)
})

test('an offline log appears on Today immediately', async ({ page, context }) => {
  await page.goto(`/?k=${TOKEN}`)
  await page.goto('/today')

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
  await expect.poll(async () => (await dbTotals()).n, { timeout: 20_000 }).toBeGreaterThan(0)
})

test('a toast does not block the tab bar (regression)', async ({ page }) => {
  await page.goto(`/?k=${TOKEN}`)
  await page.goto('/today')

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
})
