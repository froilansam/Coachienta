import { expect, test } from '@playwright/test'
import { closeDb, dropUnreferencedPlans, withDb } from './db'

/**
 * P3-2: the day plan, against real Postgres.
 *
 * The claims worth proving are the ones a screenshot cannot show: nothing is
 * written until START SESSION (AC-2.17), the started session copies its plan rather
 * than referencing the template, set counts are free (AC-2.10), and LAST/BEST are
 * gym-scoped with `—` when there is no history (AC-2.19).
 */
const TOKEN = process.env.APP_ACCESS_TOKEN!
const MARK = 'ZZTest'

/** Sessions and plans in dependency order: sets → sessions → plan rows → plans. */
const cleanup = () =>
  withDb(async (c) => {
    await c.query(
      `delete from workout_sets where session_id in
         (select id from workout_sessions where name like $1 or performed_on = '2019-09-01')`,
      [`${MARK}%`],
    )
    await c.query(
      `delete from workout_sessions where name like $1 or performed_on = '2019-09-01'`,
      [`${MARK}%`],
    )
  }).then(dropUnreferencedPlans)

test.beforeEach(cleanup)
test.afterAll(cleanup)
test.afterAll(closeDb)

const sessionCount = () =>
  withDb(async (c) => {
    const r = await c.query<{ n: string }>(`select count(*)::text n from workout_sessions`)
    return Number(r.rows[0]!.n)
  })

const open = async (page: import('@playwright/test').Page) => {
  await page.goto(`/train/plan?k=${TOKEN}`)
  await page.getByRole('heading', { name: 'New session' }).waitFor()
}

/** `Select` is a Radix combobox — open it, then pick the option. */
async function choose(page: import('@playwright/test').Page, label: string, option: string) {
  await page.getByLabel(label).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('the seeded 4-day template loads with its rep ranges', async ({ page }) => {
  await open(page)
  await choose(page, 'Template', 'Day 3 Legs')

  // Day 3 includes the two exercises the library did not have until this migration.
  await expect(page.getByText('Leg Press', { exact: true })).toBeVisible()
  await expect(page.getByText('Calf Raise', { exact: true })).toBeVisible()
  await expect(page.getByText('Plank', { exact: true })).toBeVisible()
  await expect(page.getByText('5 exercises · 15 sets')).toBeVisible()

  // A plank is targeted in SECONDS, never reps — that is what keeps it out of every
  // volume total (US-2.9, AC-2.3).
  await expect(page.getByLabel('Highest s for Plank')).toHaveValue('60')
  await expect(page.getByLabel('Highest reps for Leg Press')).toHaveValue('12')
})

test('AC-2.19 — LAST and BEST show an em dash with no history at this gym', async ({ page }) => {
  await open(page)
  await choose(page, 'Template', 'Day 1 Push')

  const body = await page.locator('main').innerText()
  expect(body).toContain('LAST')
  expect(body).toContain('BEST')
  // Never hidden, never blank. Hevy keeps `PREVIOUS` populated for the same reason.
  expect(body).toContain('—')
  // And the target says baseline rather than inventing a number.
  await expect(page.getByText(/Establish a baseline/).first()).toBeVisible()
  await expect(page.getByText(/no history for this exercise at this gym/).first()).toBeVisible()
})

test('AC-2.10 — set count and rep range are freely editable', async ({ page }) => {
  await open(page)
  await choose(page, 'Template', 'Day 1 Push')

  // A template value is a default, not a constraint (US-2.2).
  await page.getByLabel('Sets for Lateral Raises').fill('5')
  await expect(page.getByText('5 exercises · 17 sets')).toBeVisible()

  await page.getByLabel('Highest reps for Lateral Raises').fill('20')
  await expect(page.getByLabel('Highest reps for Lateral Raises')).toHaveValue('20')
})

test('AC-2.17 — nothing is written until START SESSION', async ({ page }) => {
  const before = await sessionCount()

  await open(page)
  await choose(page, 'Template', 'Day 2 Pull')
  await page.getByLabel('Sets for Pull-Ups').fill('4')
  await page.getByRole('button', { name: 'Move Lat Pulldown up' }).click()

  // Editing a draft writes nothing at all.
  expect(await sessionCount()).toBe(before)

  await page.getByLabel('Session name').fill(`${MARK} pull day`)
  await page.getByRole('button', { name: 'START SESSION' }).click()

  await page.waitForURL(/\/train\/session\//)
  await expect.poll(sessionCount).toBe(before + 1)
})

test('the started session copies the plan rather than referencing the template', async ({ page }) => {
  await open(page)
  await choose(page, 'Template', 'Day 1 Push')
  await page.getByRole('button', { name: 'Move Lateral Raises up' }).click()
  await page.getByLabel('Session name').fill(`${MARK} push day`)
  await page.getByRole('button', { name: 'START SESSION' }).click()
  await page.waitForURL(/\/train\/session\//)

  const stored = await withDb(async (c) => {
    const r = await c.query<{ is_template: boolean; name: string; position: number; exercise: string }>(
      `select p.is_template, p.name, pe.position, e.name as exercise
       from workout_sessions w
       join workout_plans p on p.id = w.plan_id
       join plan_exercises pe on pe.plan_id = p.id
       join exercises e on e.id = pe.exercise_id
       where w.name = $1 order by pe.position`,
      [`${MARK} push day`],
    )
    return r.rows
  })

  // Its own plan row, not the template — editing today must not rewrite Day 1 Push.
  expect(stored.every((r) => r.is_template === false)).toBe(true)
  // The reorder persisted into the session (AC-2.18).
  expect(stored[2]!.exercise).toBe('Lateral Raises')

  const template = await withDb(async (c) => {
    const r = await c.query<{ exercise: string }>(
      `select e.name as exercise from workout_plans p
       join plan_exercises pe on pe.plan_id = p.id
       join exercises e on e.id = pe.exercise_id
       where p.name = 'Day 1 Push' and p.is_template order by pe.position`,
    )
    return r.rows.map((x) => x.exercise)
  })
  // The template is untouched.
  expect(template[2]).toBe('Chest Press Machine')
})

test('AC-2.11 — an order violation names the critical rule', async ({ page }) => {
  await open(page)
  await choose(page, 'Template', 'Day 1 Push')

  // Day 1 is already correct — shoulder press first. Move a chest press above it.
  await page.getByRole('button', { name: 'Move Chest Press Machine up' }).click()
  await page.getByRole('button', { name: 'Move Chest Press Machine up' }).click()

  await expect(page.getByText('Shoulder press before chest')).toBeVisible()
  await expect(page.getByText(/Chest Press Machine is at 1/)).toBeVisible()
})

test('the picker adds an exercise and reuses the library list', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'ADD EXERCISE' }).click()

  await page.getByLabel('Search exercises').fill('face pulls')
  await page.getByRole('button', { name: /^Face Pulls/ }).first().click()
  await expect(page.getByRole('button', { name: /DONE — 1 IN PLAN/ })).toBeVisible()
  await page.getByRole('button', { name: /DONE — 1 IN PLAN/ }).click()

  await expect(page.getByText('1 exercise · 3 sets')).toBeVisible()
  await expect(page.getByRole('button', { name: 'START SESSION' })).toBeEnabled()
})

test('an empty plan cannot be started', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'EMPTY' }).click()
  await expect(page.getByText('NOTHING PLANNED')).toBeVisible()
  await expect(page.getByRole('button', { name: 'START SESSION' })).toHaveCount(0)
})

test('START SESSION lands on a live session ready to log', async ({ page }) => {
  await open(page)
  await choose(page, 'Template', 'Day 3 Legs')
  await page.getByLabel('Session name').fill(`${MARK} leg day`)
  await page.getByRole('button', { name: 'START SESSION' }).click()
  await page.waitForURL(/\/train\/session\//)

  await expect(page.getByRole('heading', { name: `${MARK} leg day` })).toBeVisible()
  // The plan's rep ranges came across, and the inputs are ready per load type.
  await expect(page.getByText('10–20 reps')).toBeVisible()
  await expect(page.getByLabel(/KG for set 1 of Leg Press/)).toBeVisible()
  // A plank asks for seconds and offers no weight field at all (US-2.9).
  await expect(page.getByLabel(/Seconds for set 1 of Plank/)).toBeVisible()
})
