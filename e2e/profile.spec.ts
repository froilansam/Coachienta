import { expect, test } from '@playwright/test'
import { closeDb, withDb } from './db'

/**
 * P2 items 1 and 2: the profile screen and weigh-ins.
 *
 * Weigh-ins are the only write on this screen, and they are append-only — so the
 * assertions are about what a new reading does to everything derived from it
 * (AC-4.4, AC-4.4a/b, AC-4.5).
 */
const TOKEN = process.env.APP_ACCESS_TOKEN!
/** Sentinel dates far from the real log, cleaned up either side. */
const OLD = '2019-11-01'
const NEW = '2019-11-20'
/**
 * Two dates NEWER than any real reading, for the per-field latest-wins test.
 *
 * It has to own its data. The first version asserted the dates on the live log and
 * broke the moment a real weigh-in was logged — an E2E test that reads the user's
 * mutable data is a scheduled failure, not a test.
 */
const FUTURE_WAIST = '2030-01-01'
const FUTURE_WEIGHT = '2030-01-02'

const cleanup = () =>
  withDb((c) =>
    c.query(`delete from body_measurements where measured_on in ($1, $2, $3, $4)`, [
      OLD,
      NEW,
      FUTURE_WAIST,
      FUTURE_WEIGHT,
    ]),
  )

const readRows = () =>
  withDb(async (c) => {
    const r = await c.query<{
      measured_on: string
      weight_kg: string | null
      waist_cm: string | null
      body_fat_pct: string | null
    }>(
      `select measured_on::text, weight_kg, waist_cm, body_fat_pct
       from body_measurements where measured_on in ($1, $2) order by measured_on`,
      [OLD, NEW],
    )
    return r.rows
  })

test.beforeEach(cleanup)
test.afterAll(cleanup)
test.afterAll(closeDb)

const open = async (page: import('@playwright/test').Page) => {
  await page.goto(`/profile?k=${TOKEN}`)
  // `exact` matters: getByText is a case-insensitive substring match by default,
  // and the screen's footer sentence also contains the word "current".
  await page.getByText('CURRENT', { exact: true }).waitFor()
}

test('the screen shows the stored goals, not constants (AC-4.7)', async ({ page }) => {
  await open(page)

  /**
   * Every one of these is a row in the database that Today reads too.
   *
   * `exact` throughout: `getByText` is a case-insensitive SUBSTRING match, and the
   * screen's explanatory footer mentions "priority order" and "current" in prose.
   */
  await expect(page.getByText('4-week weight-maintenance recomp')).toBeVisible()
  await expect(page.getByText('ACTIVE TARGETS', { exact: true })).toBeVisible()
  await expect(page.getByText('PRIORITY ORDER', { exact: true })).toBeVisible()
  await expect(page.getByText('Shoulders (side)', { exact: true })).toBeVisible()
  await expect(page.getByText('COACH RULES', { exact: true })).toBeVisible()
  // 20 rules are seeded; criticals are marked because the plan builder must
  // enforce them, not merely mention them.
  await expect(page.getByText('CRITICAL').first()).toBeVisible()
})

test('CURRENT dates each value by its own reading (AC-4.4b)', async ({ page }) => {
  /**
   * Two readings, each carrying only one measurement, the newer one missing the
   * waist. Taking the newest ROW wholesale would blank a waist that exists — which
   * is exactly the shape of the real log's "partial reading; blanks are honest".
   */
  await withDb(async (c) => {
    await c.query(
      `insert into body_measurements (id, measured_on, waist_cm, source)
       values (gen_random_uuid(), $1, 77.7, 'manual')`,
      [FUTURE_WAIST],
    )
    await c.query(
      `insert into body_measurements (id, measured_on, weight_kg, source)
       values (gen_random_uuid(), $1, 66.6, 'manual')`,
      [FUTURE_WEIGHT],
    )
  })

  await open(page)
  // `innerText` applies CSS `text-transform`, so a `Text variant="label"` reads as
  // WAIST rather than Waist. Match case-insensitively.
  const text = await page.locator('main').innerText()
  expect(text).toMatch(new RegExp(`weight[\\s\\S]*66\\.6[\\s\\S]*${FUTURE_WEIGHT}`, 'i'))
  expect(text).toMatch(new RegExp(`waist[\\s\\S]*77\\.7[\\s\\S]*${FUTURE_WAIST}`, 'i'))
})

test('AC-4.4a — a weigh-in saves with body fat left blank', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'LOG WEIGH-IN' }).click()

  await page.getByLabel('Date').fill(OLD)
  await page.getByLabel('Weight in kilograms').fill('71.5')
  await page.getByLabel('Waist in centimetres').fill('79.5')
  // Body fat deliberately untouched — the real log contains a partial reading
  // noted "blanks are honest", and inventing a number is worse than omitting it.
  await page.getByRole('button', { name: 'SAVE', exact: true }).click()
  await expect(page.getByText(/Saved\./)).toBeVisible()

  const rows = await readRows()
  expect(rows).toHaveLength(1)
  expect(Number(rows[0]!.weight_kg)).toBe(71.5)
  expect(Number(rows[0]!.waist_cm)).toBe(79.5)
  expect(rows[0]!.body_fat_pct).toBeNull()
})

test('weight alone is enough; without it SAVE stays disabled', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'LOG WEIGH-IN' }).click()

  // Weight is the one required field.
  await expect(page.getByRole('button', { name: 'SAVE', exact: true })).toBeDisabled()
  await page.getByLabel('Date').fill(OLD)
  await page.getByLabel('Weight in kilograms').fill('72')
  await expect(page.getByRole('button', { name: 'SAVE', exact: true })).toBeEnabled()

  await page.getByRole('button', { name: 'SAVE', exact: true }).click()
  await expect(page.getByText(/Saved\./)).toBeVisible()
  const rows = await readRows()
  expect(rows[0]!.waist_cm).toBeNull()
  expect(rows[0]!.body_fat_pct).toBeNull()
})

test('AC-4.4 — a new weigh-in appends; it never overwrites an older reading', async ({ page }) => {
  await withDb((c) =>
    c.query(
      `insert into body_measurements (id, measured_on, weight_kg, waist_cm, source)
       values (gen_random_uuid(), $1, 71.0, 82.0, 'manual')`,
      [OLD],
    ),
  )

  await open(page)
  await page.getByRole('button', { name: 'LOG WEIGH-IN' }).click()
  await page.getByLabel('Date').fill(NEW)
  await page.getByLabel('Weight in kilograms').fill('73.4')
  await page.getByRole('button', { name: 'SAVE', exact: true }).click()
  await expect(page.getByText(/Saved\./)).toBeVisible()

  const rows = await readRows()
  expect(rows).toHaveLength(2)
  // The older reading is untouched — it is a measurement in its own right.
  expect(Number(rows[0]!.weight_kg)).toBe(71.0)
  expect(Number(rows[1]!.weight_kg)).toBe(73.4)
})

test('re-weighing the same date corrects that date rather than duplicating it', async ({ page }) => {
  await withDb((c) =>
    c.query(
      `insert into body_measurements (id, measured_on, weight_kg, source)
       values (gen_random_uuid(), $1, 70.0, 'manual')`,
      [NEW],
    ),
  )

  await open(page)
  await page.getByRole('button', { name: 'LOG WEIGH-IN' }).click()
  await page.getByLabel('Date').fill(NEW)
  await page.getByLabel('Weight in kilograms').fill('70.6')
  await page.getByRole('button', { name: 'SAVE', exact: true }).click()
  await expect(page.getByText(/Saved\./)).toBeVisible()

  const rows = await readRows()
  expect(rows).toHaveLength(1)
  expect(Number(rows[0]!.weight_kg)).toBe(70.6)
})

test('AC-4.5 — BMR follows a weigh-in with no other action', async ({ page }) => {
  /**
   * Only meaningful once a birth date exists: age is part of Mifflin-St Jeor and
   * PRD-006 forbids a stored age column, so the screen blocks rather than guessing.
   */
  const hasBirthDate = await withDb(async (c) => {
    const r = await c.query<{ birth_date: string | null }>(`select birth_date from profile limit 1`)
    return r.rows[0]?.birth_date !== null
  })

  await open(page)
  if (!hasBirthDate) {
    // The honest state: named, with the reason and the fix.
    await expect(page.getByText(/Add your date of birth to compute BMR/)).toBeVisible()
    test.info().annotations.push({
      type: 'blocked',
      description: 'AC-4.5 needs profile.birth_date, which is NULL. Screen blocks correctly instead.',
    })
    return
  }

  const before = await page.locator('main').innerText()
  await page.getByRole('button', { name: 'LOG WEIGH-IN' }).click()
  await page.getByLabel('Date').fill(NEW)
  await page.getByLabel('Weight in kilograms').fill('99')
  await page.getByRole('button', { name: 'SAVE', exact: true }).click()
  await expect(page.getByText(/Saved\./)).toBeVisible()
  await expect(page.locator('main')).not.toHaveText(before)
})

test('MONITOR plots each metric and switches range', async ({ page }) => {
  await open(page)
  // The chart carries its own summary, because an SVG polyline announces nothing.
  await expect(page.getByRole('img', { name: /^Weight: \d+ readings/ })).toBeVisible()
  await expect(page.getByRole('img', { name: /^Waist: \d+ readings/ })).toBeVisible()

  await page.getByRole('radio', { name: '365D' }).click()
  await expect(page.getByRole('img', { name: /^Weight: \d+ readings/ })).toBeVisible()
})
