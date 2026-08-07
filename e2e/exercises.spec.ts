import { expect, test } from '@playwright/test'
import { closeDb, withDb } from './db'

/**
 * P3-1: the exercise library, against real Postgres.
 *
 * The screen's job is maintenance, so most of these assertions are about
 * correcting the 57 imported rows — and about AC-2.6, that a muscle group outside
 * the enum cannot be stored at all.
 */
const TOKEN = process.env.APP_ACCESS_TOKEN!
const MARK = 'ZZTest'

/**
 * Restores the seeded rows these tests correct, and drops any added ones.
 *
 * Order matters: `workout_sets.exercise_id` is a foreign key, so the sets and their
 * session have to go before the exercise they reference. Deleting the exercise
 * first fails with a constraint violation and leaves every later test broken.
 */
const cleanup = () =>
  withDb(async (c) => {
    await c.query(
      `delete from workout_sets where session_id in
         (select id from workout_sessions where name like $1)`,
      [`${MARK}%`],
    )
    await c.query(
      `delete from workout_sets where exercise_id in
         (select id from exercises where name like $1)`,
      [`${MARK}%`],
    )
    await c.query(`delete from workout_sessions where name like $1`, [`${MARK}%`])
    await c.query(`delete from exercises where name like $1`, [`${MARK}%`])
    await c.query(
      `select update_exercise(id, 'Chest Press Machine', 'chest', 'vertical_pull',
                              'external_weight', false, null)
       from exercises where name = 'Chest Press Machine'`,
    )
    await c.query(`update exercises set is_active = true where is_active = false`)
  })

const readExercise = (name: string) =>
  withDb(async (c) => {
    const r = await c.query<{
      name: string
      muscle_group: string
      movement_pattern: string
      load_type: string
      is_active: boolean
      equipment: string | null
    }>(
      `select name, muscle_group::text, movement_pattern::text, load_type::text, is_active, equipment
       from exercises where name = $1`,
      [name],
    )
    return r.rows[0] ?? null
  })

test.beforeEach(cleanup)
test.afterAll(cleanup)
test.afterAll(closeDb)

const open = async (page: import('@playwright/test').Page) => {
  await page.goto(`/train/exercises?k=${TOKEN}`)
  await page.getByRole('heading', { name: 'Exercises' }).waitFor()
}

/**
 * `Select` is a Radix combobox, not a native `<select>`, so `selectOption` does
 * not apply — open it and pick the option, the same way the log sheet's Meal
 * select is driven.
 */
async function choose(page: import('@playwright/test').Page, label: string, option: string) {
  await page.getByLabel(label).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test('the library lists every active exercise, grouped by muscle', async ({ page }) => {
  /**
   * Counted from the database, not hard-coded. The first version asserted "57
   * shown" and broke the moment migration 0017 added `Calf Raise` and `Plank` for
   * the 4-day template — a test that pins a seed count fails on the next seed.
   */
  const active = await withDb(async (c) => {
    const r = await c.query<{ n: string }>(`select count(*)::text n from exercises where is_active`)
    return Number(r.rows[0]!.n)
  })

  await open(page)
  await expect(page.getByRole('radio', { name: `ALL ${active}` })).toBeVisible()
  await expect(page.getByText(`${active} shown`)).toBeVisible()

  // Sections render for the groups that exist. Their ORDER is asserted in
  // `exercise.test.ts`, where it is a property of `group()` rather than of a text
  // index that any other copy on the page can shift.
  await expect(page.getByText('Shoulders (side)', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Leg Curl', { exact: true })).toBeVisible()
})

test('NEEDS CHECK surfaces the real import faults', async ({ page }) => {
  await open(page)
  await page.getByRole('radio', { name: /^NEEDS CHECK/ }).click()

  /**
   * PRD-004 §4.1 claims the mis-tagged chest presses and the superset names were
   * "corrected on import; flagged in the migration report". Against the live data
   * neither is true — the claim was written, the fix was not applied.
   */
  await expect(page.getByText('Chest Press Machine', { exact: true })).toBeVisible()
  await expect(page.getByText('Arms Superset — DB Bicep Curl')).toBeVisible()
  await expect(page.getByText(/movement pattern looks wrong/)).toBeVisible()
})

test('search finds an exercise by alias and by muscle group', async ({ page }) => {
  await open(page)
  await page.getByLabel('Search exercises').fill('lat pulldown')
  await expect(page.getByText('Lat Pulldown', { exact: true })).toBeVisible()

  // Muscle-group label, not just the name.
  await page.getByLabel('Search exercises').fill('hamstrings')
  await expect(page.getByText('Leg Curl', { exact: true })).toBeVisible()
})

test('correcting a movement pattern persists and clears the flag', async ({ page }) => {
  expect((await readExercise('Chest Press Machine'))!.movement_pattern).toBe('vertical_pull')

  await open(page)
  await page.getByRole('radio', { name: /^NEEDS CHECK/ }).click()
  await page.getByRole('button', { name: /^Chest Press Machine\b/ }).first().click()

  await choose(page, 'Movement pattern', 'horizontal push')
  await page.getByRole('button', { name: 'SAVE', exact: true }).click()
  await expect(page.getByText(/Chest Press Machine updated/)).toBeVisible()

  await expect
    .poll(async () => (await readExercise('Chest Press Machine'))!.movement_pattern)
    .toBe('horizontal_push')

  // A chest press IS a horizontal push, so the row stops needing attention.
  await expect(page.getByText('Chest Press Machine', { exact: true })).toBeHidden()
})

test('the load-type warning names how many logged sets would change meaning', async ({ page }) => {
  // A set has to exist for the warning to have anything to warn about.
  const ids = await withDb(async (c) => {
    const ex = await c.query<{ id: string }>(
      `insert into exercises (name, name_norm, muscle_group, movement_pattern, load_type)
       values ($1, exercise_name_norm($1), 'chest', 'horizontal_push', 'external_weight')
       returning id`,
      [`${MARK} Warned Press`],
    )
    const sess = await c.query<{ id: string }>(
      `insert into workout_sessions (id, performed_on, name)
       values (gen_random_uuid(), '2019-10-01', $1) returning id`,
      [`${MARK} session`],
    )
    await c.query(
      `insert into workout_sets (id, session_id, exercise_id, position, set_index, kind, weight_kg, reps)
       values (gen_random_uuid(), $1, $2, 1, 1, 'working', 40, 10)`,
      [sess.rows[0]!.id, ex.rows[0]!.id],
    )
    return { exercise: ex.rows[0]!.id, session: sess.rows[0]!.id }
  })

  await open(page)
  await page.getByLabel('Search exercises').fill(`${MARK} Warned Press`)
  await page.getByRole('button', { name: new RegExp(`${MARK} Warned Press`) }).click()

  // Changing to `assisted` removes volume, because lower assist is better.
  await choose(page, 'Load type', 'Assisted')
  await expect(page.getByText(/1 logged set would stop counting toward volume/)).toBeVisible()
  // A warning, not a block — you may have mis-declared it originally.
  await expect(page.getByRole('button', { name: 'SAVE', exact: true })).toBeEnabled()

  // `cleanup` removes the rest in dependency order before the next test.
  void ids
})

test('a new exercise is added and appears in its muscle section', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'NEW' }).click()

  await page.getByLabel('Name').fill(`${MARK} Cable Fly`)
  await choose(page, 'Muscle group', 'Chest')
  await choose(page, 'Movement pattern', 'isolation')
  await page.getByLabel('Equipment').fill('Cable')
  await page.getByRole('button', { name: 'SAVE', exact: true }).click()

  await expect(page.getByText(/Cable Fly added/)).toBeVisible()
  const row = await readExercise(`${MARK} Cable Fly`)
  expect(row).toMatchObject({ muscle_group: 'chest', movement_pattern: 'isolation', equipment: 'Cable' })
})

test('a duplicate name is refused with a readable reason', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'NEW' }).click()
  await page.getByLabel('Name').fill('Leg Curl')
  await page.getByRole('button', { name: 'SAVE', exact: true }).click()

  await expect(page.getByText(/already exists/)).toBeVisible()
})

test('retiring keeps the row and moves it to RETIRED', async ({ page }) => {
  await withDb((c) =>
    c.query(
      `insert into exercises (name, name_norm, muscle_group, movement_pattern, load_type)
       values ($1, exercise_name_norm($1), 'quads', 'squat', 'external_weight')`,
      [`${MARK} Retire Me`],
    ),
  )

  await open(page)
  await page.getByLabel('Search exercises').fill(`${MARK} Retire Me`)
  await page.getByRole('button', { name: new RegExp(`${MARK} Retire Me`) }).click()
  await page.getByRole('button', { name: 'RETIRE' }).click()
  await expect(page.getByText(/retired/)).toBeVisible()

  // Retired, not deleted — history that references it must stay readable.
  await expect.poll(async () => (await readExercise(`${MARK} Retire Me`))?.is_active).toBe(false)
  await page.getByRole('radio', { name: /^RETIRED/ }).click()
  // By role: the success notice repeats the name, so `getByText` matches twice.
  await expect(page.getByRole('button', { name: new RegExp(`${MARK} Retire Me`) })).toBeVisible()
})

test('AC-2.6 — a muscle group outside the enum is rejected', async ({ page }) => {
  await page.goto(`/train/exercises?k=${TOKEN}`)

  const res = await page.request.post('/api/data/exercises', {
    data: {
      action: 'add',
      name: `${MARK} Bogus`,
      muscle_group: 'not_a_muscle',
      movement_pattern: 'isolation',
      load_type: 'external_weight',
      is_unilateral: false,
      equipment: '',
    },
  })
  expect(res.status()).toBe(400)
  expect(await readExercise(`${MARK} Bogus`)).toBeNull()
})
