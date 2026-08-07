import { expect, test } from '@playwright/test'
import { closeDb, withDb } from './db'

/**
 * P1f: the food library, against real Postgres.
 *
 * The centrepiece is **AC-1.6** — correcting a food must not change a single past
 * log entry. It is the highest-risk unproven claim in the project: a silent
 * history rewrite would corrupt every chart retroactively and there would be no
 * way to notice. Everything else here is the destructive stuff: the delete gate,
 * merge, and the usage counter.
 */
const TOKEN = process.env.APP_ACCESS_TOKEN!
/** A date no real log will use, so nothing collides with the user's data. */
const DAY = '2019-12-30'
const PREFIX = 'ZZTest'

const cleanup = () =>
  withDb(async (c) => {
    await c.query(`delete from food_log_entries where logged_on = $1`, [DAY])
    await c.query(`delete from foods where name like $1`, [`${PREFIX}%`])
  })

interface Made {
  id: string
  name: string
}

/** A food plus, optionally, log entries pointing at it. */
async function makeFood(
  name: string,
  opts: { entries?: number; timesLogged?: number; source?: 'library' | 'usda' } = {},
) {
  return withDb(async (c) => {
    const f = await c.query<Made>(
      `insert into foods (name, name_norm, basis_unit, basis_amount, kcal, protein_g, carbs_g, fat_g,
                          confidence, source, times_logged, citations)
       values ($1, food_name_norm($1), 'g', 100, 200, 10, 20, 8, 'medium', $3, $2,
               '[{"ref":"test fixture","url":null,"detail":null}]'::jsonb)
       returning id, name`,
      [name, opts.timesLogged ?? opts.entries ?? 0, opts.source ?? 'library'],
    )
    const id = f.rows[0]!.id
    for (let i = 0; i < (opts.entries ?? 0); i++) {
      await c.query(
        `insert into food_log_entries (id, logged_on, meal, food_id, food_version, food_name,
           amount, unit, kcal, protein_g, carbs_g, fat_g, confidence, resolved_by)
         values (gen_random_uuid(), $1, 'Lunch', $2, 1, $3, 200, 'g', 400, 20, 40, 16, 'medium', 'library')`,
        [DAY, id, name],
      )
    }
    return { id, name }
  })
}

const readFood = (id: string) =>
  withDb(async (c) => {
    const r = await c.query<{
      name: string
      kcal: string
      version: number
      confidence: string
      times_logged: number
    }>(`select name, kcal, version, confidence, times_logged from foods where id = $1`, [id])
    return r.rows[0] ?? null
  })

const readEntries = (foodId: string) =>
  withDb(async (c) => {
    const r = await c.query<{ kcal: string; food_version: number; food_name: string }>(
      `select kcal, food_version, food_name from food_log_entries where food_id = $1 order by kcal`,
      [foodId],
    )
    return r.rows
  })

test.beforeEach(cleanup)
test.afterAll(cleanup)
test.afterAll(closeDb)

async function openLibrary(page: import('@playwright/test').Page, search: string) {
  await page.goto(`/food/library?k=${TOKEN}`)
  await page.getByRole('heading', { name: 'Food library' }).waitFor()
  await page.getByLabel('Search your library').fill(search)
  await page.getByRole('button', { name: new RegExp(search) }).first().waitFor()
}

// ---------------------------------------------------------------------------
// AC-1.6 — the one that matters
// ---------------------------------------------------------------------------
test('AC-1.6 — correcting a food never rewrites a logged entry', async ({ page }) => {
  const food = await makeFood(`${PREFIX} Rice`, { entries: 2 })
  const before = await readEntries(food.id)
  expect(before).toHaveLength(2)
  expect(Number(before[0]!.kcal)).toBe(400)

  await openLibrary(page, `${PREFIX} Rice`)
  await page.getByRole('button', { name: new RegExp(`${PREFIX} Rice`) }).first().click()
  await page.getByLabel('Calories').waitFor()

  // Change the macros to something unmistakably different.
  await page.getByLabel('Calories').fill('999')
  await page.getByLabel('Protein in grams').fill('99')
  await page.getByRole('button', { name: 'SAVE & VERIFY' }).click()
  await expect(page.getByText(/is now verified/)).toBeVisible()

  const after = await readFood(food.id)
  expect(Number(after!.kcal)).toBe(999)
  // A correction is a new version of the food, and it is now user-verified.
  expect(after!.version).toBe(2)
  expect(after!.confidence).toBe('user_verified')

  // The whole point: history is untouched, values AND food_version.
  const entriesAfter = await readEntries(food.id)
  expect(entriesAfter).toEqual(before)
})

test('the editor shows where the numbers came from (AC-1.3)', async ({ page }) => {
  await makeFood(`${PREFIX} Cited`)
  await openLibrary(page, `${PREFIX} Cited`)
  await page.getByRole('button', { name: new RegExp(`${PREFIX} Cited`) }).first().click()

  // Collapsed by default — provenance is an occasional question.
  const toggle = page.getByRole('button', { name: /1 SOURCE/ })
  await expect(toggle).toBeVisible()
  await expect(page.getByText('test fixture')).toBeHidden()
  await toggle.click()
  await expect(page.getByText('test fixture')).toBeVisible()
})

// ---------------------------------------------------------------------------
// AC-1.25 — the delete gate
// ---------------------------------------------------------------------------
test('AC-1.25 — a referenced food cannot be deleted, and says why', async ({ page }) => {
  const food = await makeFood(`${PREFIX} Referenced`, { entries: 1 })
  await openLibrary(page, `${PREFIX} Referenced`)
  await page.getByRole('button', { name: new RegExp(`${PREFIX} Referenced`) }).first().click()

  await expect(page.getByRole('button', { name: /DELETE/ })).toBeDisabled()
  await expect(page.getByText(/1 logged entry uses this food/)).toBeVisible()
  expect(await readFood(food.id)).not.toBeNull()
})

test('a food nothing references is deletable even with a high usage counter', async ({ page }) => {
  // The reported bug: 67 lifetime logs, zero surviving entries.
  const food = await makeFood(`${PREFIX} Orphan`, { timesLogged: 67 })
  await openLibrary(page, `${PREFIX} Orphan`)
  await page.getByRole('button', { name: new RegExp(`${PREFIX} Orphan`) }).first().click()

  const del = page.getByRole('button', { name: /DELETE/ })
  await expect(del).toBeEnabled()
  // Allowed, but it still says the food has history behind it.
  await expect(page.getByText(/eaten 67×/)).toBeVisible()

  await del.click()
  await expect(page.getByText(/Deleted/)).toBeVisible()
  await expect.poll(() => readFood(food.id)).toBeNull()
})

// ---------------------------------------------------------------------------
// AC-1.13 / AC-1.26 — merge
// ---------------------------------------------------------------------------
test('AC-1.13 — merge sums usage, repoints entries and keeps the old name findable', async ({
  page,
}) => {
  const survivor = await makeFood(`${PREFIX} Eggs`, { timesLogged: 27 })
  const loser = await makeFood(`${PREFIX} Egg`, { entries: 1, timesLogged: 10 })
  const loserEntries = await readEntries(loser.id)

  await openLibrary(page, `${PREFIX} Egg`)
  await page.getByRole('button', { name: new RegExp(`${PREFIX} Egg\\b`) }).first().click()
  await page.getByRole('button', { name: 'MERGE' }).click()
  await page.getByLabel('Find the other food').waitFor()
  await page.getByLabel('Find the other food').fill(`${PREFIX} Eggs`)

  await page.getByRole('button', { name: new RegExp(`${PREFIX} Eggs`) }).first().click()
  await page.getByRole('radiogroup', { name: /survives/ }).waitFor()
  // Default keeps the more-logged row; assert the plan says so before committing.
  await expect(page.getByText(new RegExp(`"${PREFIX} Egg" disappears`))).toBeVisible()
  await expect(page.getByText(/37×/)).toBeVisible()

  await page.getByRole('button', { name: 'MERGE', exact: true }).click()
  await expect(page.getByText(/Merged into/)).toBeVisible()

  const kept = await readFood(survivor.id)
  expect(kept!.times_logged).toBe(37)
  expect(await readFood(loser.id)).toBeNull()

  // Entries moved, and their frozen macros did not change.
  const moved = await readEntries(survivor.id)
  expect(moved.map((m) => m.kcal)).toEqual(loserEntries.map((m) => m.kcal))
  expect(moved[0]!.food_name).toBe(`${PREFIX} Egg`)

  // The old spelling still resolves, via the alias.
  const aliased = await withDb(async (c) => {
    const r = await c.query<{ name: string }>(
      `select name from library_foods($1, 'all', 5)`,
      [`${PREFIX} Egg`],
    )
    return r.rows.map((x) => x.name)
  })
  expect(aliased).toContain(`${PREFIX} Eggs`)
})

test('AC-1.26 — a cross-basis merge is refused, not converted', async ({ page }) => {
  await makeFood(`${PREFIX} Grams`)
  await withDb((c) =>
    c.query(
      `insert into foods (name, name_norm, basis_unit, basis_amount, kcal, protein_g, carbs_g, fat_g, confidence, source)
       values ($1, food_name_norm($1), 'piece', 1, 80, 6, 1, 5, 'medium', 'library')`,
      [`${PREFIX} Pieces`],
    ),
  )

  await openLibrary(page, `${PREFIX} Grams`)
  await page.getByRole('button', { name: new RegExp(`${PREFIX} Grams`) }).first().click()
  await page.getByRole('button', { name: 'MERGE' }).click()
  await page.getByLabel('Find the other food').fill(`${PREFIX} Pieces`)
  await page.getByRole('button', { name: new RegExp(`${PREFIX} Pieces`) }).first().click()

  await expect(page.getByText(/no weight to convert with/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'MERGE', exact: true })).toBeDisabled()
})

// ---------------------------------------------------------------------------
// AC-1.24 / AC-1.28 — pruning and the usage counter
// ---------------------------------------------------------------------------
test('AC-1.24 — pruning removes only unreferenced foods the app wrote itself', async () => {
  const keep = await makeFood(`${PREFIX} Kept`, { entries: 1 })
  // A lookup leftover: written by the app while resolving a search, never eaten.
  const drop = await makeFood(`${PREFIX} Dropped`, { source: 'usda' })
  /**
   * Curated and never eaten — the case that matters most. Prune used to delete by
   * "has this been eaten?" alone, so clearing the food log made the entire imported
   * library qualify at once and a single CLEAR took 223 of 239 foods.
   */
  const curated = await makeFood(`${PREFIX} Curated`, { source: 'library' })
  // A stale counter must not protect a row, and must not condemn one either.
  await withDb((c) =>
    c.query(`update foods set times_logged = 0 where id = $1`, [keep.id]),
  )

  /**
   * Inside a transaction that is ALWAYS rolled back.
   *
   * `prune_unlogged_foods()` is global — it deletes every qualifying row, not just this
   * test's fixtures. Run for real it once took 223 of 239 foods, because the food log
   * had been cleared and "never eaten" then described the entire library. The RPC is now
   * scoped to lookup-created sources, but a test that permanently deletes rows it did
   * not create is the wrong shape regardless of how well the function behaves.
   *
   * `withDb` shares one connection per worker, so the assertions below see the
   * uncommitted state and the real function is still exercised end to end.
   */
  await withDb(async (c) => {
    await c.query('begin')
    try {
      const r = await c.query<{ prune_unlogged_foods: number }>(`select prune_unlogged_foods()`)
      expect(r.rows[0]!.prune_unlogged_foods).toBeGreaterThanOrEqual(1)

      const dropped = await c.query(`select 1 from foods where id = $1`, [drop.id])
      expect(dropped.rowCount).toBe(0)
      // Referenced despite times_logged = 0.
      const kept = await c.query(`select 1 from foods where id = $1`, [keep.id])
      expect(kept.rowCount).toBe(1)
      // Curated, unreferenced, and still here. This is the regression guard.
      const survived = await c.query(`select 1 from foods where id = $1`, [curated.id])
      expect(survived.rowCount).toBe(1)
    } finally {
      await c.query('rollback')
    }
  })
})

test('AC-1.28 — deleting a log entry undoes its usage bump', async () => {
  const food = await makeFood(`${PREFIX} Counter`)
  await withDb((c) => c.query(`select bump_food_usage($1, 200)`, [food.id]))
  expect((await readFood(food.id))!.times_logged).toBe(1)

  await withDb((c) => c.query(`select unbump_food_usage($1)`, [food.id]))
  expect((await readFood(food.id))!.times_logged).toBe(0)

  // Floors at zero: the counter starts from imported history, so it must never
  // go negative.
  await withDb((c) => c.query(`select unbump_food_usage($1)`, [food.id]))
  expect((await readFood(food.id))!.times_logged).toBe(0)
})
