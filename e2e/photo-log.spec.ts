import { expect, test } from '@playwright/test'
import { closeDb, withDb } from './db'

/**
 * P1d: photo logging. AC-1.9 — a photo produces CANDIDATES, never entries.
 *
 * The vision call is stubbed. That is deliberate, not a shortcut: the claim under
 * test is that the review screen has no write path, and a stub is the only way to
 * assert it against a known set of items on every run. Real model accuracy is a
 * separate question that no assertion can settle (see `scripts/probe-vision.mts`).
 */
const TOKEN = process.env.APP_ACCESS_TOKEN!
const DAY = '2020-01-02'

/**
 * A valid 8×8 PNG. `createImageBitmap` really decodes this, so the bytes have to
 * be sound — a corrupt IDAT makes `prepareImage` reject, and the UI reports that
 * as "could not read that photo", which looks exactly like the failure a stubbed
 * test is meant to rule out.
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGM4UWGDFTEMLQkAQfNfAVTFtrMAAAAASUVORK5CYII=',
  'base64',
)

const countEntries = () =>
  withDb(async (c) => {
    const r = await c.query<{ n: string }>(
      `select count(*)::text as n from food_log_entries where logged_on = $1`,
      [DAY],
    )
    return Number(r.rows[0]?.n ?? '0')
  })

const clear = () =>
  withDb((c) => c.query(`delete from food_log_entries where logged_on = $1`, [DAY]))

test.beforeAll(clear)
test.afterAll(closeDb)
test.afterAll(clear)

/** Two matched items and one the databases could not resolve. */
async function stubVision(page: import('@playwright/test').Page) {
  const rice = await withDb(async (c) => {
    const r = await c.query(
      `select * from foods where name_norm = food_name_norm('White rice (cooked)') limit 1`,
    )
    return r.rows[0]
  })
  const chicken = await withDb(async (c) => {
    const r = await c.query(`select * from foods where name ilike 'Chicken breast%' limit 1`)
    return r.rows[0]
  })
  expect(rice, 'seed must contain white rice').toBeTruthy()
  expect(chicken, 'seed must contain chicken breast').toBeTruthy()

  await page.route('**/api/data/resolve-photo', (route) =>
    route.fulfill({
      json: {
        kind: 'plate',
        dishName: 'Chicken and rice',
        label: null,
        sceneNotes: null,
        degraded: false,
        notice: null,
        items: [
          {
            key: 'i0',
            name: 'White rice (cooked)',
            amount: 200,
            unit: 'g',
            reasoning: 'A standard rice bowl, filled level',
            visionConfidence: 'medium',
            food: rice,
          },
          {
            key: 'i1',
            name: 'Chicken breast',
            amount: 120,
            unit: 'g',
            reasoning: 'Roughly half a breast',
            visionConfidence: 'high',
            food: chicken,
          },
          {
            key: 'i2',
            name: 'Unidentifiable garnish',
            amount: 10,
            unit: 'g',
            reasoning: 'Small green flecks',
            visionConfidence: 'low',
            food: null,
          },
        ],
      },
    }),
  )
}

async function shootPhoto(page: import('@playwright/test').Page) {
  await page.goto(`/?k=${TOKEN}`)
  await page.getByRole('button', { name: 'LOG FOOD' }).click()
  await page.getByLabel('Search foods').waitFor()
  await page
    .getByLabel('Take a photo of food or a nutrition label')
    .setInputFiles({ name: 'meal.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByText('AI-DETECTED ITEMS')).toBeVisible()
}

test('a photo yields candidates and writes nothing on its own (AC-1.9)', async ({ page }) => {
  await stubVision(page)
  await shootPhoto(page)

  // Every item is present with its reasoning visible — you cannot correct an
  // estimate whose basis is hidden.
  await expect(page.getByText('A standard rice bowl, filled level')).toBeVisible()
  await expect(page.getByText('Roughly half a breast')).toBeVisible()

  // The unmatched one is called out rather than silently dropped.
  await expect(page.getByText(/had no macro match/)).toBeVisible()

  // Nothing has been written, and the button is an ADD, not a save.
  expect(await countEntries()).toBe(0)
  await expect(page.getByRole('button', { name: 'ADD 2 ITEMS' })).toBeVisible()

  // Discarding leaves the database untouched.
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(page.getByLabel('Search foods')).toBeVisible()
  expect(await countEntries()).toBe(0)
})

test('grams are editable and macros follow the correction', async ({ page }) => {
  await stubVision(page)
  await shootPhoto(page)

  const total = page.getByText('TOTAL').locator('..')
  const before = await total.innerText()

  await page.getByLabel('Amount of White rice (cooked) in g').fill('400')
  await expect(total).not.toHaveText(before)

  // 200 g → 400 g of the same food must double that item's contribution, so the
  // total has to rise.
  const kcalOf = (s: string) => Number(/(\d[\d.]*)\s*kcal/.exec(s)?.[1] ?? '0')
  expect(kcalOf(await total.innerText())).toBeGreaterThan(kcalOf(before))
})

test('excluded items leave the basket, and confirming commits exactly what is shown', async ({
  page,
}) => {
  await stubVision(page)
  await shootPhoto(page)

  await page.getByLabel('Include Chicken breast').click()
  await expect(page.getByRole('button', { name: 'ADD 1 ITEM' })).toBeVisible()

  await page.getByLabel('Log date').fill(DAY)
  await page.getByRole('button', { name: 'ADD 1 ITEM' }).click()

  // Photo items land in the same basket as typed ones — one commit path.
  await expect(page.getByRole('button', { name: /LOG 1 ITEM/ })).toBeVisible()
  expect(await countEntries()).toBe(0)

  await page.getByRole('button', { name: /LOG 1 ITEM/ }).click()
  await expect
    .poll(countEntries, { message: 'the confirmed item should reach the database' })
    .toBe(1)

  const rows = await withDb(async (c) => {
    const r = await c.query<{ food_name: string; amount: string; resolved_by: string }>(
      `select food_name, amount, resolved_by from food_log_entries where logged_on = $1`,
      [DAY],
    )
    return r.rows
  })
  expect(rows[0]?.food_name).toContain('White rice')
  expect(Number(rows[0]?.amount)).toBe(200)
})

test.describe('pasted text', () => {
  // A stubbed route is invisible once the service worker controls the page.
  test.use({ serviceWorkers: 'block' })

  test('pasted text becomes candidates and writes nothing on its own', async ({ page }) => {
    const before = await countEntries()
    await page.route('**/api/data/resolve-paste', (route) =>
      route.fulfill({
        json: {
          kind: 'plate',
          dishName: 'Breakfast',
          label: null,
          sceneNotes: null,
          degraded: false,
          items: [
            {
              key: 'egg',
              name: 'Egg',
              amount: 2,
              unit: 'piece',
              reasoning: 'written as 2 eggs',
              visionConfidence: 'high',
              food: null,
            },
            {
              key: 'rice',
              name: 'White rice (cooked)',
              amount: 200,
              unit: 'g',
              reasoning: 'written as 200g',
              visionConfidence: 'high',
              food: null,
            },
          ],
        },
      }),
    )

    await page.goto(`/?k=${TOKEN}`)
    await page.getByRole('button', { name: 'LOG FOOD' }).click()
    await page.getByLabel('Paste food').fill('2 eggs, 200g rice')
    await page.getByRole('button', { name: 'SORT' }).click()

    await expect(page.getByRole('button', { name: /Names were taken from the text you pasted/ })).toBeVisible()
    await expect(page.getByText('written as 2 eggs')).toBeVisible()
    await expect(page.getByText('written as 200g')).toBeVisible()
    await expect(page.getByRole('button', { name: 'ADD 0 ITEMS' })).toBeVisible()
    expect(await countEntries()).toBe(before)
  })
})

test('a vision failure never blocks typing (AC-1.12)', async ({ page }) => {
  let hit = false
  await page.route('**/api/data/resolve-photo', (route) => {
    hit = true
    return route.fulfill({ status: 500 })
  })
  await page.goto(`/?k=${TOKEN}`)
  await page.getByRole('button', { name: 'LOG FOOD' }).click()
  await page
    .getByLabel('Take a photo of food or a nutrition label')
    .setInputFiles({ name: 'meal.png', mimeType: 'image/png', buffer: PNG })

  await expect(page.getByText(/Could not read that photo/)).toBeVisible()
  // The message must come from the 500, not from a photo the browser could not
  // decode — those two failures look identical on screen.
  expect(hit, 'the vision route should have been called').toBe(true)
  // The search field is still there and still works.
  await page.getByLabel('Search foods').fill('rice')
  await expect(page.getByRole('button', { name: /White rice/ })).toBeVisible()
})
