import { expect, test, type Page } from '@playwright/test'
import { closeDb, dropUnreferencedPlans, withDb } from './db'

/**
 * P3-5 — prompt → AI draft plan (PRD-004 §4.2a).
 *
 * Plan QUALITY is not assertable here, for the same reason vision accuracy is not:
 * whether `Upper Body` produced a sensible session is a judgement, and
 * `npm run probe:plan` is the tool for it. What IS assertable is every mechanical
 * claim, and those are the ones that would silently rot:
 *
 * - **AC-2.15** every `exercise_id` exists in the library — checked against Postgres.
 * - **AC-2.17** BUILD writes nothing at all.
 * - **AC-2.18** edits to a draft persist into the started session.
 * - **AC-2.20** a failing builder is recoverable, and Template / Empty still work.
 *
 * Most of these stub the route, so they are deterministic and cost no quota. Exactly
 * one test spends a real model call, because "the model cannot invent an exercise" is
 * only worth anything against the real model.
 */
const TOKEN = process.env.APP_ACCESS_TOKEN!
const MARK = 'ZZAi'

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

const sessionCount = () =>
  withDb(async (c) => {
    const r = await c.query<{ n: string }>(`select count(*)::text n from workout_sessions`)
    return Number(r.rows[0]!.n)
  })

const planCount = () =>
  withDb(async (c) => {
    const r = await c.query<{ n: string }>(
      `select count(*)::text n from workout_plans where not is_template`,
    )
    return Number(r.rows[0]!.n)
  })

/** Two library exercises, so a stubbed draft can name ids that really exist. */
const twoExercises = () =>
  withDb(async (c) => {
    const r = await c.query<{ id: string; name: string }>(
      `select id, name from exercises where name in ('Lat Pulldown', 'Leg Press') order by name`,
    )
    return r.rows
  })

const open = async (page: Page) => {
  await page.goto(`/train/plan?k=${TOKEN}`)
  await page.getByRole('heading', { name: 'New session' }).waitFor()
}

const build = async (page: Page, prompt: string) => {
  await page.getByLabel('Prompt').fill(prompt)
  await page.getByRole('button', { name: 'BUILD' }).click()
}

// ---------------------------------------------------------------------------
// Against the real model — once
// ---------------------------------------------------------------------------
test('AC-2.15 / AC-2.17 — a real draft invents nothing, and writes nothing', async ({ page }) => {
  const sessionsBefore = await sessionCount()
  const plansBefore = await planCount()

  await open(page)
  await build(page, 'Upper Body')

  /**
   * Skipped, not failed, when the day's provider quota is gone.
   *
   * This is the one test that spends a real model call, and Groq's free tier is 100k
   * tokens a day — shared with the coach. Reporting red because the provider is empty
   * would be a false negative about the code, and it trained me once already to look for
   * a regression that was not there. The notice appearing IS AC-2.20 working.
   */
  const draft = page.getByText('AI DRAFT · EDIT FREELY')
  const outOfQuota = page.getByText(/Out of AI quota/)
  await expect(draft.or(outOfQuota).first()).toBeVisible({ timeout: 60_000 })
  test.skip(
    await outOfQuota.isVisible(),
    "provider quota exhausted for today — re-run once it resets (the notice itself is AC-2.20)",
  )
  await expect(draft).toBeVisible()

  /**
   * AC-2.15 the honest way. Every name on screen has to be a row in `exercises` —
   * a hallucinated machine would render just as convincingly as a real one, so the
   * library is the only thing worth comparing against.
   */
  const library = await withDb(async (c) => {
    const r = await c.query<{ name: string }>(`select name from exercises`)
    return new Set(r.rows.map((x) => x.name))
  })
  /**
   * Read off each row's own remove button rather than its text: `PlanRowCard` renders
   * the name in a `<span>`, and `Remove <name>` is the one place the exact library name
   * is guaranteed to appear verbatim.
   */
  const shown = await page.getByRole('button', { name: /^Remove / }).evaluateAll((els) =>
    els.map((el) => (el.getAttribute('aria-label') ?? '').replace(/^Remove /, '')),
  )
  expect(shown.length).toBeGreaterThan(0)
  for (const name of shown) expect(library.has(name)).toBe(true)

  // AC-2.17: a draft is a draft. Not one row was written to plan or session.
  expect(await sessionCount()).toBe(sessionsBefore)
  expect(await planCount()).toBe(plansBefore)
  await expect(page.getByRole('button', { name: 'START SESSION' })).toBeEnabled()
})

// ---------------------------------------------------------------------------
// Stubbed — deterministic, and no quota
// ---------------------------------------------------------------------------
/**
 * `page.route` stops intercepting once the Serwist service worker takes control of a
 * `next start` build, so a stub would be handed straight to the real server. This has
 * bitten twice before; blocking the worker is the fix.
 */
test.describe('with the builder stubbed', () => {
  test.use({ serviceWorkers: 'block' })

  const stub = async (page: Page, body: unknown, status = 200) => {
    await page.route('**/api/ai/plan-workout', (r) =>
      r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
    )
  }

  const draftOf = (rows: Array<{ id: string; name: string }>, notice: string | null = null) => ({
    title: `${MARK} stub draft`,
    rationale: 'Chosen to satisfy the priority order and the critical rules.',
    notice,
    degraded: false,
    items: rows.map((row) => ({
      exercise_id: row.id,
      name: row.name,
      target_sets: 3,
      rep_low: 8,
      rep_high: 12,
      why: `${row.name} because of the priority order`,
    })),
  })

  test('AC-2.20 — a failing builder is recoverable, and Template still works', async ({ page }) => {
    await stub(page, { error: 'Out of AI quota for the moment. Try again later, or use a template.' }, 503)

    await open(page)
    await build(page, 'Upper Body')

    // A sentence, not a stack trace — and it names what still works.
    await expect(page.getByText(/Out of AI quota/)).toBeVisible()
    await expect(page.getByText(/use a template/)).toBeVisible()
    // No draft chip: nothing was built, and the screen does not pretend otherwise.
    await expect(page.getByText('AI DRAFT · EDIT FREELY')).toHaveCount(0)

    // The whole point of AC-2.20: the other two paths are untouched.
    await page.getByLabel('Template').click()
    await page.getByRole('option', { name: 'Day 1 Push', exact: true }).click()
    await expect(page.getByText('5 exercises · 15 sets')).toBeVisible()
    await expect(page.getByRole('button', { name: 'START SESSION' })).toBeEnabled()
  })

  test('the rationale is a real disclosure, not a hover-only tooltip', async ({ page }) => {
    const rows = await twoExercises()
    await stub(page, draftOf(rows))

    await open(page)
    await build(page, 'Upper Body')
    await expect(page.getByText('AI DRAFT · EDIT FREELY')).toBeVisible()

    // Collapsed by default, and openable by tapping — a tooltip would be unreachable
    // on a phone, where this app lives.
    const toggle = page.getByRole('button', { name: 'WHY THESE CHOICES' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByText(/satisfy the priority order/)).toHaveCount(0)
    await toggle.click()
    await expect(page.getByText(/satisfy the priority order/)).toBeVisible()
  })

  test('a server-side correction is reported, never hidden', async ({ page }) => {
    const rows = await twoExercises()
    await stub(page, draftOf(rows, '2 suggested exercises not in your library — dropped.'))

    await open(page)
    await build(page, 'Upper Body')
    // A draft quietly edited on the way out is a draft you cannot reason about.
    await expect(page.getByText(/2 suggested exercises not in your library/)).toBeVisible()
  })

  test('AC-2.18 — edits to a draft persist into the started session', async ({ page }) => {
    const rows = await twoExercises()
    await stub(page, draftOf(rows))

    await open(page)
    await build(page, 'Upper Body')
    await expect(page.getByText('AI DRAFT · EDIT FREELY')).toBeVisible()
    // The model's title becomes the session name — one less thing to type.
    await expect(page.getByLabel('Session name')).toHaveValue(`${MARK} stub draft`)

    // The draft lands in the same list a template does, so every control works on it.
    await page.getByLabel(`Sets for ${rows[1]!.name}`).fill('5')
    await page.getByRole('button', { name: `Move ${rows[1]!.name} up` }).click()

    await page.getByRole('button', { name: 'START SESSION' }).click()
    await page.waitForURL(/\/train\/session\//)

    const stored = await withDb(async (c) => {
      const r = await c.query<{ position: number; exercise: string; target_sets: number }>(
        `select pe."position", e.name as exercise, pe.target_sets
         from workout_sessions w
         join plan_exercises pe on pe.plan_id = w.plan_id
         join exercises e on e.id = pe.exercise_id
         where w.name = $1 order by pe."position"`,
        [`${MARK} stub draft`],
      )
      return r.rows
    })
    // Reorder and set-count both survived into the session.
    expect(stored[0]!.exercise).toBe(rows[1]!.name)
    expect(stored[0]!.target_sets).toBe(5)
  })

  test('§6 — building again over existing rows asks before discarding them', async ({ page }) => {
    const rows = await twoExercises()
    await stub(page, draftOf(rows))

    await open(page)
    await page.getByLabel('Template').click()
    await page.getByRole('option', { name: 'Day 1 Push', exact: true }).click()
    await expect(page.getByText('5 exercises · 15 sets')).toBeVisible()

    await build(page, 'Upper Body')

    // It does not silently throw away a plan you may have spent time on.
    await expect(page.getByText(/You already have 5 exercises planned/)).toBeVisible()

    // ADD TO PLAN keeps them and appends: 5 + 2.
    await page.getByRole('button', { name: 'ADD TO PLAN' }).click()
    await expect(page.getByText('7 exercises · 21 sets')).toBeVisible()

    // REPLACE swaps the lot for the draft alone.
    await build(page, 'Upper Body')
    await page.getByRole('button', { name: 'REPLACE' }).click()
    await expect(page.getByText('2 exercises · 6 sets')).toBeVisible()
  })

  test('BUILD is inert until there is something to build from', async ({ page }) => {
    await open(page)
    // An empty prompt cannot spend a request, and a one-character one is not a session.
    await expect(page.getByRole('button', { name: 'BUILD' })).toBeDisabled()
    await page.getByLabel('Prompt').fill('u')
    await expect(page.getByRole('button', { name: 'BUILD' })).toBeDisabled()
    await page.getByLabel('Prompt').fill('Upper Body')
    /**
     * Enabled only once the exercise library has arrived too. A draft is mapped
     * through the library exactly once, so building before it loads dropped every id
     * and rendered an `AI DRAFT` chip above an empty plan — found by this suite.
     */
    await expect(page.getByRole('button', { name: 'BUILD' })).toBeEnabled()
  })
})
