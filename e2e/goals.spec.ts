import { expect, test } from '@playwright/test'
import { closeDb, withDb } from './db'

/**
 * P2 items 3, 5 and 6: editing targets and phase, the rules registry, the prompt
 * preview, and the consistency checks end to end.
 *
 * Every edit here is a **supersede**. The assertions are mostly about what
 * survives: the old row keeps its date range (AC-4.3) and a retired rule stays
 * visible while leaving the prompt (AC-4.9). Overwriting in place would silently
 * re-score every historical day.
 */
const TOKEN = process.env.APP_ACCESS_TOKEN!
const MARK = 'ZZTest'
/** Newer than any real reading, so the checks fire on data this test owns. */
const FIXTURE_DAY = '2030-02-01'

/**
 * Restores the single active row in each effective-dated table. These tables have
 * a `one_active_*` unique index, so a leftover open row from a failed test would
 * break every later one.
 */
const cleanup = () =>
  withDb(async (c) => {
    await c.query(`delete from coach_rules where source like '%in app' or title like $1`, [`${MARK}%`])
    await c.query(`update coach_rules set superseded_by = null, is_active = true
                   where source = 'Migrated from Coach Agent tab'`)
    await c.query(`delete from nutrition_targets where phase_label like $1`, [`${MARK}%`])
    await c.query(`delete from training_phases where label like $1`, [`${MARK}%`])
    await c.query(`update nutrition_targets set effective_to = null
                   where effective_from = (select max(effective_from) from nutrition_targets)`)
    await c.query(`update training_phases set effective_to = null
                   where effective_from = (select max(effective_from) from training_phases)`)
    await c.query(`delete from body_measurements where measured_on = $1`, [FIXTURE_DAY])
    // Restore the seeded priority order — the editor replaces the whole list.
    await c.query(`select reorder_physique_priorities(
      array['shoulders_side','back_lats','chest','biceps','quads']::muscle_group[],
      array['Capped side delts — primary V-taper driver','Lat width and upper-back',
            'Upper chest fullness','Proportional arms','Athletic, not primary'])`)
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

/** Tomorrow, which is the earliest date a supersede may open on. */
function tomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// AC-4.3 / AC-4.10 / AC-4.11 — targets
// ---------------------------------------------------------------------------
test('AC-4.3 — changing targets supersedes; the old row keeps its date range', async ({ page }) => {
  const before = await withDb(async (c) => {
    const r = await c.query<{ n: string }>(`select count(*)::text n from nutrition_targets`)
    return Number(r.rows[0]!.n)
  })

  await open(page)
  await page.getByRole('button', { name: 'Change' }).nth(1).click()
  await page.getByLabel('Phase label').fill(`${MARK} superseded phase`)
  await page.getByLabel('Gym day calorie low').fill('2500')
  await page.getByLabel('Gym day calorie high').fill('2600')
  await page.getByRole('button', { name: 'SAVE', exact: true }).click()
  // The card shows the numbers, not the target's phase_label, so assert the value.
  await expect(page.getByText('2500–2600 kcal')).toBeVisible()

  const rows = await withDb(async (c) => {
    const r = await c.query<{ phase_label: string; effective_from: string; effective_to: string | null }>(
      `select phase_label, effective_from::text, effective_to::text from nutrition_targets
       order by effective_from`,
    )
    return r.rows
  })

  expect(rows).toHaveLength(before + 1)
  const closed = rows[rows.length - 2]!
  const active = rows[rows.length - 1]!
  // The old row is closed, not deleted, and its range ends the day before.
  expect(closed.effective_to).not.toBeNull()
  expect(active.effective_to).toBeNull()
  expect(active.effective_from).toBe(tomorrow())
  expect(new Date(closed.effective_to!) < new Date(active.effective_from)).toBe(true)
})

test('AC-4.10 — a target under the floor is blocked, live and on the server', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Change' }).nth(1).click()
  await page.getByLabel('Gym day calorie low').fill('1500')

  // Live, as you type: the reason and both numbers, and SAVE goes dead.
  // "a safety rule, not a preference" also appears on the card behind the sheet,
  // which is the point — the same words in both places.
  await expect(page.getByText(/1500 kcal is below your 1800 kcal floor/)).toBeVisible()
  await expect(page.getByText(/safety rule, not a preference/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'SAVE', exact: true })).toBeDisabled()

  // And the server refuses independently — a form is not where a safety rule lives.
  const res = await page.request.post('/api/data/goals', {
    data: {
      action: 'targets',
      effective_from: tomorrow(),
      phase_label: `${MARK} bypass`,
      kcal_gym_low: 1500, kcal_gym_high: 1600, kcal_rest_low: 1500, kcal_rest_high: 1600,
      protein_g: 160,
      carbs_gym_low: 100, carbs_gym_high: 120, carbs_rest_low: 100, carbs_rest_high: 120,
      fat_low: 50, fat_high: 60, kcal_floor: 1800, rationale: null,
    },
  })
  expect(res.status()).toBe(422)
  expect(await res.text()).toContain('below your 1800 kcal floor')

  const leaked = await withDb(async (c) => {
    const r = await c.query<{ n: string }>(
      `select count(*)::text n from nutrition_targets where phase_label like $1`, [`${MARK}%`])
    return Number(r.rows[0]!.n)
  })
  expect(leaked).toBe(0)
})

test('AC-4.11 — macros over the calorie ceiling warn without blocking', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Change' }).nth(1).click()
  // 4·160 + 4·400 + 9·65 = 2,825 against a 2,400 ceiling.
  await page.getByLabel('Carbs gym low').fill('400')

  await expect(page.getByText(/above your 2400 kcal ceiling/)).toBeVisible()
  // A warning is information the user may accept — only the floor blocks.
  await expect(page.getByRole('button', { name: 'SAVE', exact: true })).toBeEnabled()
})

test('a backdated supersede is refused with a reason from the database', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Change' }).nth(1).click()
  await page.getByLabel('Phase label').fill(`${MARK} backdated`)
  // Before the current row began — the closed row would end before it started.
  await page.getByLabel('In effect from').fill('2020-01-01')
  await page.getByRole('button', { name: 'SAVE', exact: true }).click()

  await expect(page.getByText(/must start after/)).toBeVisible()
})

// ---------------------------------------------------------------------------
// Phase
// ---------------------------------------------------------------------------
test('changing the phase supersedes it and Today follows', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Change' }).first().click()
  await page.getByLabel('Label').fill(`${MARK} new phase`)
  await page.getByLabel('Target rate per week').fill('0.25')
  await page.getByRole('button', { name: 'SAVE', exact: true }).click()
  await expect(page.getByText(`${MARK} new phase`)).toBeVisible()

  const rows = await withDb(async (c) => {
    const r = await c.query<{ label: string; effective_to: string | null }>(
      `select label, effective_to::text from training_phases order by effective_from`)
    return r.rows
  })
  expect(rows[rows.length - 1]!.label).toBe(`${MARK} new phase`)
  expect(rows[rows.length - 2]!.effective_to).not.toBeNull()
})

// ---------------------------------------------------------------------------
// AC-4.9 — rules
// ---------------------------------------------------------------------------
test('a new rule appears in the registry and in the prompt', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Add a coach rule' }).click()
  await page.getByLabel('Title').fill(`${MARK} deload every sixth week`)
  await page.getByLabel('Instruction').fill('Cut volume by 40% on the sixth week.')
  await page.getByRole('button', { name: 'SAVE', exact: true }).click()

  await expect(page.getByText(`${MARK} deload every sixth week`)).toBeVisible()

  // The prompt is assembled by the same function the coach will call (AC-4.12).
  await page.getByRole('button', { name: 'PREVIEW COACH PROMPT' }).click()
  await expect(page.getByText(/Cut volume by 40% on the sixth week/)).toBeVisible()
})

test('AC-4.9 — superseding a rule retires the original and drops it from the prompt', async ({
  page,
}) => {
  await open(page)
  await page.getByRole('button', { name: 'Add a coach rule' }).click()
  await page.getByLabel('Title').fill(`${MARK} original rule`)
  await page.getByLabel('Instruction').fill('The original instruction.')
  await page.getByRole('button', { name: 'SAVE', exact: true }).click()
  await expect(page.getByText(`${MARK} original rule`)).toBeVisible()

  // Tapping a rule opens its replacement editor.
  await page.getByRole('button', { name: `${MARK} original rule` }).click()
  await expect(page.getByText(/Saving creates a replacement/)).toBeVisible()
  await page.getByLabel('Title').fill(`${MARK} replacement rule`)
  await page.getByLabel('Instruction').fill('The replacement instruction.')
  await page.getByRole('button', { name: 'SAVE', exact: true }).click()

  await expect(page.getByText(`${MARK} replacement rule`)).toBeVisible()
  await expect(page.getByText(`${MARK} original rule`)).toBeHidden()

  const state = await withDb(async (c) => {
    const r = await c.query<{ title: string; is_active: boolean; superseded_by: string | null }>(
      `select title, is_active, superseded_by from coach_rules where title like $1 order by title`,
      [`${MARK}%`],
    )
    return r.rows
  })
  const original = state.find((r) => r.title.includes('original'))!
  const replacement = state.find((r) => r.title.includes('replacement'))!
  // The old row STAYS — history, not deletion — and points at its replacement.
  expect(original.is_active).toBe(false)
  expect(original.superseded_by).not.toBeNull()
  expect(replacement.is_active).toBe(true)

  await page.getByRole('button', { name: 'PREVIEW COACH PROMPT' }).click()
  await expect(page.getByText(/The replacement instruction/)).toBeVisible()
  await expect(page.getByText(/The original instruction/)).toBeHidden()
  await expect(page.getByText(/retired rules excluded/)).toBeVisible()
})

test('a critical rule is marked in the prompt, not merely present (AC-4.8)', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Add a coach rule' }).click()
  await page.getByLabel('Title').fill(`${MARK} critical rule`)
  await page.getByLabel('Instruction').fill('This one is non-negotiable.')
  await page.getByRole('switch', { name: 'Critical' }).click()
  await page.getByRole('button', { name: 'SAVE', exact: true }).click()

  await page.getByRole('button', { name: 'PREVIEW COACH PROMPT' }).click()
  await expect(page.getByText(/\[CRITICAL\] ZZTest critical rule/)).toBeVisible()
})

// ---------------------------------------------------------------------------
// AC-4.14 — priority order
// ---------------------------------------------------------------------------
const priorityOrder = () =>
  withDb(async (c) => {
    const r = await c.query<{ rank: number; muscle_group: string; note: string | null }>(
      `select rank, muscle_group, note from physique_priorities order by rank`,
    )
    return r.rows
  })

test('AC-4.14 — reordering priorities rewrites the ranks with no gaps', async ({ page }) => {
  expect((await priorityOrder()).map((p) => p.muscle_group)).toEqual([
    'shoulders_side', 'back_lats', 'chest', 'biceps', 'quads',
  ])

  await open(page)
  await page.getByRole('button', { name: 'Reorder' }).click()
  // Promote back / lats above shoulders. One statement cannot do this — `rank` is
  // the primary key and `muscle_group` is unique, so the swap collides midway.
  await page.getByRole('button', { name: 'Move Back / lats up' }).click()
  await page.getByRole('button', { name: 'SAVE', exact: true }).click()

  await expect(page.getByText('PRIORITY ORDER', { exact: true })).toBeVisible()
  await expect.poll(async () => (await priorityOrder()).map((p) => p.muscle_group)).toEqual([
    'back_lats', 'shoulders_side', 'chest', 'biceps', 'quads',
  ])
  // Ranks stay 1..n with no gaps, which is what makes volume share answerable.
  expect((await priorityOrder()).map((p) => p.rank)).toEqual([1, 2, 3, 4, 5])
})

test('notes travel with the row they belong to', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Reorder' }).click()
  await page.getByRole('button', { name: 'Move Back / lats up' }).click()
  await page.getByRole('button', { name: 'SAVE', exact: true }).click()
  await expect(page.getByText('PRIORITY ORDER', { exact: true })).toBeVisible()

  await expect.poll(async () => (await priorityOrder())[0]).toMatchObject({
    muscle_group: 'back_lats',
    note: 'Lat width and upper-back',
  })
})

test('adding a group appends it, and SAVE is inert until something moves', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'Reorder' }).click()

  // Nothing changed yet — an unchanged list must not be worth writing.
  await expect(page.getByRole('button', { name: 'SAVE', exact: true })).toBeDisabled()

  // The chip's `aria-label` is the accessible name — it overrides the "+ Triceps"
  // text, which is the point: "+ Triceps" alone does not say what happens.
  await page.getByRole('button', { name: 'Add Triceps to the priority order' }).click()
  await expect(page.getByRole('button', { name: 'SAVE', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'SAVE', exact: true }).click()

  await expect.poll(async () => (await priorityOrder()).map((p) => p.muscle_group)).toEqual([
    'shoulders_side', 'back_lats', 'chest', 'biceps', 'quads', 'triceps',
  ])
})

test('the priority order reaches the coach prompt', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'PREVIEW COACH PROMPT' }).click()
  // Ranked order, in the FACTS block — this is how the coach can notice that your
  // stated priority and your actual training disagree.
  await expect(page.getByText(/shoulders side > back lats/)).toBeVisible()
})

// ---------------------------------------------------------------------------
// Item 6 — the checks, on what is stored
// ---------------------------------------------------------------------------
test('a breached body-fat ceiling is reported inline, exactly once', async ({ page }) => {
  /**
   * Owns its data. The first version read the live log and passed until a real
   * weigh-in changed the numbers — the trend warning stopped firing and the test
   * failed for a reason that had nothing to do with the code. An E2E test that
   * depends on the user's mutable data is a scheduled failure.
   */
  await withDb((c) =>
    c.query(
      `insert into body_measurements (id, measured_on, weight_kg, body_fat_pct, source)
       values (gen_random_uuid(), $1, 70, 30, 'manual')`,
      [FIXTURE_DAY],
    ),
  )

  await open(page)
  // 30% against the phase's 15% ceiling, stated at the value it concerns...
  await expect(page.getByText(/over your 15% ceiling/)).toBeVisible()
  // ...and once only. PRD-006 §4 wants it inline, not also collected in a banner.
  await expect(page.getByText(/15% ceiling/)).toHaveCount(1)
})
