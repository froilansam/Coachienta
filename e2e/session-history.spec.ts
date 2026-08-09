import { expect, test } from '@playwright/test'
import { closeDb, dropUnreferencedPlans, withDb } from './db'

/**
 * AC-2.21 / AC-2.22 / AC-2.23 — session history, deletion, and mid-session editing.
 *
 * The claims that need a database rather than a screenshot: deleting a session takes
 * its sets with it and stops feeding LAST/BEST, and removing an exercise mid-session
 * deletes the sets already logged against it. Both are irreversible, so both are
 * asserted against Postgres and not against what the list happens to render.
 */
const TOKEN = process.env.APP_ACCESS_TOKEN!
const MARK = 'ZZHist'

const cleanup = () =>
  withDb(async (c) => {
    await c.query(
      `delete from workout_sets where session_id in
         (select id from workout_sessions where name like $1)`,
      [`${MARK}%`],
    )
    await c.query(`delete from workout_sessions where name like $1`, [`${MARK}%`])
  }).then(dropUnreferencedPlans)

test.beforeEach(cleanup)
test.afterAll(cleanup)
test.afterAll(closeDb)

const countSessions = (name: string) =>
  withDb(async (c) => {
    const r = await c.query<{ n: string }>(
      `select count(*)::text n from workout_sessions where name = $1`,
      [name],
    )
    return Number(r.rows[0]!.n)
  })

const countSets = (name: string) =>
  withDb(async (c) => {
    const r = await c.query<{ n: string }>(
      `select count(*)::text n from workout_sets s
       join workout_sessions w on w.id = s.session_id where w.name = $1`,
      [name],
    )
    return Number(r.rows[0]!.n)
  })

const positionsOf = (name: string) =>
  withDb(async (c) => {
    const r = await c.query<{ position: number; exercise: string }>(
      `select pe."position", e.name as exercise
       from workout_sessions w
       join plan_exercises pe on pe.plan_id = w.plan_id
       join exercises e on e.id = pe.exercise_id
       where w.name = $1 order by pe."position"`,
      [name],
    )
    return r.rows
  })

async function startSession(
  page: import('@playwright/test').Page,
  template: string,
  name: string,
) {
  await page.goto(`/train/plan?k=${TOKEN}`)
  await page.getByRole('heading', { name: 'New session' }).waitFor()
  await page.getByLabel('Template').click()
  await page.getByRole('option', { name: template, exact: true }).click()
  await page.getByLabel('Session name').fill(name)
  await page.getByRole('button', { name: 'START SESSION' }).click()
  await page.waitForURL(/\/train\/session\//)
}

async function logSet(
  page: import('@playwright/test').Page,
  exercise: string,
  weight: string,
  reps: string,
) {
  await page.getByLabel(new RegExp(`KG for set 1 of ${exercise}`)).fill(weight)
  await page.getByLabel(new RegExp(`Reps for set 1 of ${exercise}`)).fill(reps)
  await page.getByRole('checkbox', { name: new RegExp(`Save set 1 of ${exercise}`) }).click()
  await page.getByRole('checkbox', { name: new RegExp(`Set 1 of ${exercise} saved`) }).waitFor()
}

// ---------------------------------------------------------------------------
test('AC-2.21 — Train lists sessions grouped by date, and a row opens the session', async ({
  page,
}) => {
  await startSession(page, 'Day 1 Push', `${MARK} push`)
  await logSet(page, 'Shoulder Press Machine', '55', '10')
  await expect.poll(() => countSets(`${MARK} push`)).toBe(1)

  await page.goto(`/train?k=${TOKEN}`)
  // Grouped by `performed_on`, and today's group says so rather than printing a date.
  await expect(page.getByRole('heading', { name: 'TODAY' })).toBeVisible()
  // The summary is what actually happened: no invented duration, and a live badge.
  await expect(page.getByText(/550 kg · 1 set/)).toBeVisible()
  await expect(page.getByText('LIVE', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: new RegExp(`${MARK} push`) }).click()
  await page.waitForURL(/\/train\/session\//)
  await expect(page.getByRole('heading', { name: `${MARK} push` })).toBeVisible()
})

test('a session with no sets says so instead of showing 0 kg', async ({ page }) => {
  await startSession(page, 'Day 1 Push', `${MARK} empty`)

  await page.goto(`/train?k=${TOKEN}`)
  await expect(page.getByText(/nothing logged/)).toBeVisible()
})

test('AC-2.22 — deleting a session removes its sets and stops feeding LAST/BEST', async ({
  page,
}) => {
  await startSession(page, 'Day 1 Push', `${MARK} doomed`)
  await logSet(page, 'Shoulder Press Machine', '70', '10')
  await expect.poll(() => countSets(`${MARK} doomed`)).toBe(1)

  // That set is history now, so the plan screen offers it as BEST.
  await page.goto(`/train/plan?k=${TOKEN}`)
  await page.getByLabel('Template').click()
  await page.getByRole('option', { name: 'Day 1 Push', exact: true }).click()
  await expect(page.getByText(/70 kg/).first()).toBeVisible()

  await page.goto(`/train?k=${TOKEN}`)
  await page.getByRole('button', { name: new RegExp(`Delete ${MARK} doomed`) }).click()

  // The confirm names the exact number of sets that will go — the only warning there
  // is, because there is no undo after this (§6).
  await expect(page.getByText(/1 set will be removed\. This cannot be undone\./)).toBeVisible()
  await page.getByRole('button', { name: 'DELETE' }).click()

  // Sets cascade at the database. One delete, and everything derived from it goes.
  await expect.poll(() => countSets(`${MARK} doomed`)).toBe(0)
  await expect.poll(() => countSessions(`${MARK} doomed`)).toBe(0)

  // Gone from the list...
  await expect(page.getByText(`${MARK} doomed`)).toHaveCount(0)

  // ...and gone from LAST/BEST, which are computed and never stored (AC-2.7).
  await page.goto(`/train/plan?k=${TOKEN}`)
  await page.getByLabel('Template').click()
  await page.getByRole('option', { name: 'Day 1 Push', exact: true }).click()
  await expect(page.getByText(/Establish a baseline/).first()).toBeVisible()
  await expect(page.getByText(/70 kg/)).toHaveCount(0)
})

test('AC-2.23 — an exercise can be added mid-session, with PREV', async ({ page }) => {
  await startSession(page, 'Day 1 Push', `${MARK} add`)
  await page.getByLabel(/KG for set 1 of Shoulder Press Machine/).waitFor()

  await page.getByRole('button', { name: 'ADD EXERCISE' }).click()
  await page.getByLabel('Search exercises').fill('face pulls')
  await page.getByRole('button', { name: /^Face Pulls/ }).first().click()

  // A new block, appended, ready to log — and PREV is populated with `—` rather than
  // hidden, the same rule as every other row (AC-2.2).
  await expect(page.getByLabel(/KG for set 1 of Face Pulls/)).toBeVisible()
  await expect(page.getByText('—').first()).toBeVisible()

  // It went into the SESSION's plan, at the end. The template is untouched.
  await expect.poll(() => positionsOf(`${MARK} add`).then((r) => r.at(-1)?.exercise)).toBe('Face Pulls')

  const template = await withDb(async (c) => {
    const r = await c.query<{ n: string }>(
      `select count(*)::text n from workout_plans p
       join plan_exercises pe on pe.plan_id = p.id
       join exercises e on e.id = pe.exercise_id
       where p.name = 'Day 1 Push' and p.is_template and e.name = 'Face Pulls'`,
    )
    return Number(r.rows[0]!.n)
  })
  expect(template).toBe(0)

  // The session is still open — adding an exercise is not finishing anything.
  await expect(page.getByRole('button', { name: 'FINISH SESSION' })).toBeEnabled()
})

test('AC-2.23 — removing an exercise deletes the sets logged against it', async ({ page }) => {
  await startSession(page, 'Day 1 Push', `${MARK} remove`)
  await logSet(page, 'Shoulder Press Machine', '55', '10')
  await expect.poll(() => countSets(`${MARK} remove`)).toBe(1)

  const before = await positionsOf(`${MARK} remove`)
  expect(before[0]!.exercise).toBe('Shoulder Press Machine')

  await page
    .getByRole('button', { name: 'Remove Shoulder Press Machine from this session' })
    .click()
  await expect(page.getByText(/1 saved set will be deleted/)).toBeVisible()
  await page.getByRole('button', { name: 'REMOVE' }).click()

  // The sets go with the exercise. Keeping them would leave volume in every total
  // with nothing on screen to explain it.
  await expect.poll(() => countSets(`${MARK} remove`)).toBe(0)
  await expect(page.getByLabel(/KG for set 1 of Shoulder Press Machine/)).toHaveCount(0)

  // Positions close up rather than leaving a gap, or the remaining sets would render
  // against the wrong exercise after a reload.
  const after = await positionsOf(`${MARK} remove`)
  expect(after.map((r) => r.position)).toEqual(after.map((_, i) => i + 1))
  expect(after).toHaveLength(before.length - 1)

  // And the session stays open.
  await expect(page.getByRole('button', { name: 'FINISH SESSION' })).toBeEnabled()
})
