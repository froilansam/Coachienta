import { expect, test } from '@playwright/test'
import { closeDb, withDb } from './db'

/**
 * P1b: the log sheet. AC-1.1 (two taps, offline), AC-1.10 (multi-item),
 * AC-1.11 (offline persist then sync exactly once).
 */
const TOKEN = process.env.APP_ACCESS_TOKEN!
/** A date no real log will use, so assertions cannot collide with real data. */
const DAY = '2020-01-01'

const entries = () =>
  withDb(async (c) => {
    const r = await c.query<{ food_name: string; amount: string; kcal: string }>(
      `select food_name, amount, kcal from food_log_entries where logged_on = $1 order by food_name`,
      [DAY],
    )
    return r.rows
  })

const clear = () =>
  withDb((c) => c.query(`delete from food_log_entries where logged_on = $1`, [DAY]))

test.beforeAll(clear)
test.afterAll(closeDb)
test.afterAll(clear)

/** The search is debounced 350 ms; clicking sooner hits the stale recent list. */
async function typeAndWait(page: import('@playwright/test').Page, term: string) {
  const responded = page.waitForResponse(
    (r) => r.url().includes('/api/data/resolve-food') && r.request().method() === 'POST',
  )
  await page.getByLabel('Search foods').fill(term)
  await responded
}

async function openSheet(page: import('@playwright/test').Page, day?: string) {
  await page.goto(`/?k=${TOKEN}`)
  await page.getByRole('button', { name: 'LOG FOOD' }).click()
  await page.getByLabel('Search foods').waitFor()
  // Log to a sentinel date so DB assertions never collide with real entries.
  if (day) await page.getByLabel('Log date').fill(day)
}

test('recent foods appear before typing — the two-tap path', async ({ page }) => {
  await openSheet(page)
  // Seeded library, ordered by times_logged. White rice has 110 logs.
  await expect(page.getByRole('button', { name: /White rice \(cooked\)/ })).toBeVisible()
  await expect(page.getByText('YOUR FOODS')).toBeVisible()
})

test('logs a library food in two taps, fully offline', async ({ page, context }) => {
  await openSheet(page, DAY)
  await context.setOffline(true)

  // Tap 1: pick the food. Tap 2: confirm the prefilled portion.
  await page.getByRole('button', { name: /White rice \(cooked\)/ }).first().click()
  await expect(page.getByRole('button', { name: 'ADD' })).toBeVisible()
  // Prefilled from usual_amount (200 g), so no typing is needed.
  await expect(page.getByRole('textbox', { name: 'Amount in g' })).toHaveValue('200')
  await page.getByRole('button', { name: 'ADD' }).click()

  await expect(page.getByRole('button', { name: /LOG 1 ITEM/ })).toBeVisible()
  await page.getByRole('button', { name: /LOG 1 ITEM/ }).click()

  // Nothing can have reached the server yet.
  expect(await entries()).toHaveLength(0)
  await expect(page.getByText('Logged 1 item', { exact: true })).toBeVisible()

  await context.setOffline(false)
  await expect.poll(async () => (await entries()).length, { timeout: 20_000 }).toBe(1)

  const [row] = await entries()
  expect(Number(row!.amount)).toBe(200)
  expect(Number(row!.kcal)).toBeCloseTo(252, 0)
})

test('a multi-item input offers each food separately (AC-1.10)', async ({ page }) => {
  await openSheet(page)
  await typeAndWait(page, '200g tofu, 140g rice')

  await expect(page.getByText('SEVERAL FOODS — PICK ONE AT A TIME')).toBeVisible()
  await expect(page.getByText('200g tofu')).toBeVisible()
  await expect(page.getByText('140g rice')).toBeVisible()

  // Tapping a segment searches just that food.
  await page.getByText('140g rice').click()
  await expect(page.getByLabel('Search foods')).toHaveValue('140g rice')
})

test('a quantity in the query prefills the portion', async ({ page }) => {
  await openSheet(page)
  await typeAndWait(page, '150g white rice')
  await page.getByRole('button', { name: /White rice \(cooked\)/ }).first().click()
  // 150 comes from the query, overriding the 200 g habit.
  await expect(page.getByRole('textbox', { name: 'Amount in g' })).toHaveValue('150')
})

test('non-food input is rejected before it can pollute a day', async ({ page }) => {
  await openSheet(page)
  await typeAndWait(page, 'Nutrition planning session')
  await expect(page.getByText('NOT A FOOD')).toBeVisible()
})

test('two foods commit as two separate entries', async ({ page }) => {
  await openSheet(page, DAY)

  for (const [term, name] of [
    ['white rice', /White rice \(cooked\)/],
    ['sunny side up', /Sunny side up eggs/],
  ] as const) {
    await typeAndWait(page, term)
    await page.getByRole('button', { name: name }).first().click()
    await page.getByRole('button', { name: 'ADD' }).click()
  }

  await expect(page.getByRole('button', { name: /LOG 2 ITEMS/ })).toBeVisible()
  await page.getByRole('button', { name: /LOG 2 ITEMS/ }).click()

  await expect.poll(async () => (await entries()).length, { timeout: 20_000 }).toBe(2)
})
