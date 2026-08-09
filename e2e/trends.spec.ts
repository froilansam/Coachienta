import { expect, test } from '@playwright/test'
import { closeDb, dropUnreferencedPlans, withDb } from './db'

/**
 * P3-4: personal records and the trends screen, against real Postgres.
 *
 * Two things are worth this much setup. **PR detection runs on the client** (§4.3) —
 * so the only proof that a verdict is right is what lands in `workout_sets.is_pr`,
 * which a screenshot of an orange chip cannot give. And **AC-2.14**: the per-muscle
 * parts must add up to the total, which is the check the spreadsheet's dashboard
 * failed silently for 9,352 kg.
 */
const TOKEN = process.env.APP_ACCESS_TOKEN!
const MARK = 'ZZTrend'

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

interface SetRow {
  is_pr: boolean
  pr_kinds: string[]
  weight_kg: string | null
  reps: number | null
}

const setsOf = (name: string) =>
  withDb(async (c) => {
    const r = await c.query<SetRow>(
      `select s.is_pr, s.pr_kinds, s.weight_kg, s.reps
       from workout_sets s join workout_sessions w on w.id = s.session_id
       where w.name = $1 order by s.position, s.set_index`,
      [name],
    )
    return r.rows
  })

async function startSession(
  page: import('@playwright/test').Page,
  template: string,
  name: string,
): Promise<void> {
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
// PRs
// ---------------------------------------------------------------------------
test('AC-2.5 — the first set at a gym is a baseline, not a record', async ({ page }) => {
  await startSession(page, 'Day 1 Push', `${MARK} first`)
  await logSet(page, 'Shoulder Press Machine', '60', '8')

  await expect.poll(() => setsOf(`${MARK} first`)).toHaveLength(1)
  const [row] = await setsOf(`${MARK} first`)

  // The one rule that stops every opening session being a wall of records — and the
  // direct fix for the spreadsheet's 335 PRs across 41 sessions.
  expect(row!.is_pr).toBe(false)
  expect(row!.pr_kinds).toEqual(['first_time'])
  // Nothing is stamped, either.
  await expect(page.getByLabel(/^Personal record/)).toHaveCount(0)
})

test('beating a previous set stamps PR and stores what was beaten', async ({ page }) => {
  await startSession(page, 'Day 1 Push', `${MARK} base`)
  await logSet(page, 'Shoulder Press Machine', '60', '8')
  await expect.poll(() => setsOf(`${MARK} base`)).toHaveLength(1)

  // A second session the same day: `prior_sets` excludes only the CURRENT session,
  // so this one can see the first one's 60 kg.
  await startSession(page, 'Day 1 Push', `${MARK} beat`)
  await logSet(page, 'Shoulder Press Machine', '65', '8')

  // Stamped with no round trip — the verdict was decided on the client at commit.
  const stamp = page.getByLabel(/^Personal record/)
  await expect(stamp).toBeVisible()
  await expect(stamp).toHaveAttribute('aria-label', /New weight/)
  // And it names its evidence, the same standard every suggestion is held to (AC-2.8).
  await expect(stamp).toHaveAttribute('title', /65 kg × 8 beats 60 kg × 8/)

  await expect.poll(() => setsOf(`${MARK} beat`)).toHaveLength(1)
  const [row] = await setsOf(`${MARK} beat`)
  expect(row!.is_pr).toBe(true)
  expect(row!.pr_kinds).toContain('weight')
})

test('a warmup is never a PR, however heavy', async ({ page }) => {
  await startSession(page, 'Day 1 Push', `${MARK} base2`)
  await logSet(page, 'Shoulder Press Machine', '60', '8')
  await expect.poll(() => setsOf(`${MARK} base2`)).toHaveLength(1)

  await startSession(page, 'Day 1 Push', `${MARK} warmup`)
  await page.getByRole('button', { name: 'Mark Shoulder Press Machine set 1 as warmup' }).click()
  await logSet(page, 'Shoulder Press Machine', '80', '8')

  await expect.poll(() => setsOf(`${MARK} warmup`)).toHaveLength(1)
  const [row] = await setsOf(`${MARK} warmup`)
  // 80 kg beats the 60 kg on record, but beating a warmup — or setting one — is not
  // a personal record.
  expect(row!.is_pr).toBe(false)
  expect(row!.pr_kinds).toEqual([])
})

// ---------------------------------------------------------------------------
// The trends screen
// ---------------------------------------------------------------------------
/**
 * Seeds three days of real history at the current gym. Written straight to Postgres
 * rather than through the UI: this test is about what the READ queries do with a
 * shape of data, and building it by hand would be forty interactions.
 */
async function seedHistory() {
  await withDb(async (c) => {
    const gym = await c.query<{ id: string }>(`select id from gyms where is_current limit 1`)
    const gymId = gym.rows[0]!.id
    const ex = await c.query<{ id: string; name: string }>(
      `select id, name from exercises where name in ('Lateral Raises', 'Lat Pulldown', 'Plank')`,
    )
    const idOf = (n: string) => ex.rows.find((r) => r.name === n)!.id

    // Three days across two calendar weeks, with the load rising on lateral raises.
    const days = [
      { offset: 15, lateral: 10, pulldown: 45 },
      { offset: 8, lateral: 12.5, pulldown: 50 },
      { offset: 1, lateral: 15, pulldown: 55 },
    ]

    for (const [i, day] of days.entries()) {
      // `id` has no default anywhere in this schema — the CLIENT mints the uuid so a
      // replayed offline flush upserts instead of duplicating (§7). A seed has to do
      // the same thing the app does.
      const s = await c.query<{ id: string }>(
        `insert into workout_sessions (id, name, performed_on, gym_id, completed_at)
         values (gen_random_uuid(), $1, current_date - $2::int, $3, now()) returning id`,
        [`${MARK} seeded ${i}`, day.offset, gymId],
      )
      const sid = s.rows[0]!.id
      await c.query(
        `insert into workout_sets (id, session_id, exercise_id, position, set_index, kind, weight_kg, reps)
         values (gen_random_uuid(), $1, $2, 1, 1, 'working', $3, 12),
                (gen_random_uuid(), $1, $2, 1, 2, 'working', $3, 11)`,
        [sid, idOf('Lateral Raises'), day.lateral],
      )
      await c.query(
        `insert into workout_sets (id, session_id, exercise_id, position, set_index, kind, weight_kg, reps)
         values (gen_random_uuid(), $1, $2, 2, 1, 'working', $3, 10)`,
        [sid, idOf('Lat Pulldown'), day.pulldown],
      )
      // A plank: seconds, and no volume by definition (AC-2.3).
      await c.query(
        `insert into workout_sets (id, session_id, exercise_id, position, set_index, kind, duration_sec)
         values (gen_random_uuid(), $1, $2, 3, 1, 'working', 60)`,
        [sid, idOf('Plank')],
      )
    }
  })
}

test.describe('trends', () => {
  test.beforeEach(seedHistory)

  test('AC-2.14 — the per-muscle parts add up, and no leak is reported', async ({ page }) => {
    await page.goto(`/trends?k=${TOKEN}`)
    await page.getByRole('heading', { name: 'Trends', exact: true }).waitFor()

    await expect(page.getByRole('heading', { name: 'Volume by muscle group' })).toBeVisible()
    // The failure sentence is absent because every set attributes to a group.
    await expect(page.getByText(/could not be attributed to a muscle group/)).toHaveCount(0)

    /**
     * The real assertion: every bar's accessible name carries the total AND the
     * breakdown, so the arithmetic can be checked from the rendered page rather than
     * from the query that produced it.
     */
    const labels = await page.locator('[aria-label*=" kg — "]').all()
    expect(labels.length).toBeGreaterThan(0)
    for (const bar of labels) {
      const text = (await bar.getAttribute('aria-label'))!
      // Decimals are real here: 12.5 kg × 11 is 137.5, and a parser that assumed
      // integers would silently skip the bars most likely to be wrong.
      const [, totalRaw, breakdown] = text.match(/: ([\d,.]+) kg — (.+)$/)!
      const total = Number(totalRaw!.replace(/,/g, ''))
      const parts = [...breakdown!.matchAll(/([\d,.]+)/g)].map((m) => Number(m[1]!.replace(/,/g, '')))
      expect(parts.reduce((n, p) => n + p, 0)).toBeCloseTo(total, 1)
    }
  })

  test('a plank carries sets but no kilograms', async ({ page }) => {
    /**
     * This asserted that `Abs / core` was absent from the VOLUME legend — a proxy that
     * held only while the seeded plank was the sole abs work in the window. It is not
     * any more: a real `Abs Machine (Total Abdominal)` set carries 950 kg, correctly,
     * because it is `external_weight`. The proxy was wrong, not the app.
     *
     * So assert the claim itself. Abs kilograms on screen must equal the kilograms the
     * weighted sets produce — the plank adds sets to that group and nothing to its
     * volume. A duration set leaking into volume (43,368 kg of nothing, §AC-2.3) shows
     * up here as a mismatch no matter what else was trained.
     */
    const abs = await withDb(async (c) => {
      const r = await c.query<{ kg: string; sets: string; planks: string }>(
        `select coalesce(sum(s.volume_kg), 0) kg, count(*) sets,
                count(*) filter (where e.name = 'Plank') planks
           from workout_sets s
           join workout_sessions w on w.id = s.session_id
           join gyms g on g.id = w.gym_id and g.is_current
           join exercises e on e.id = s.exercise_id
          where e.muscle_group = 'abs_core'
            and w.performed_on >= current_date - 84`,
      )
      const x = r.rows[0]!
      return { kg: Number(x.kg), sets: Number(x.sets), planks: Number(x.planks) }
    })
    // Without this the test could pass on a window that never held a plank at all.
    expect(abs.planks).toBeGreaterThan(0)

    /** Abs across every weekly bar, read back out of the bars' own accessible names. */
    const absOnScreen = async () => {
      const bars = await page.locator('[aria-label*=" — "]').all()
      let sum = 0
      for (const bar of bars) {
        const m = (await bar.getAttribute('aria-label'))!.match(/Abs \/ core ([\d,.]+)/)
        if (m) sum += Number(m[1]!.replace(/,/g, ''))
      }
      return sum
    }

    await page.goto(`/trends?k=${TOKEN}`)
    await page.getByRole('heading', { name: 'Volume by muscle group' }).waitFor()
    // Per-week rounding to 1 dp, summed across up to 12 weeks.
    expect(await absOnScreen()).toBeCloseTo(abs.kg, 0)

    // And the same sets, counted, the moment the measure changes.
    await page.getByRole('radio', { name: 'Sets' }).click()
    await expect(page.getByRole('heading', { name: 'Sets by muscle group' })).toBeVisible()
    expect(await absOnScreen()).toBe(abs.sets)
  })

  test('strength progression draws one line per gym, in estimated 1RM', async ({ page }) => {
    await page.goto(`/trends?k=${TOKEN}`)
    await page.getByRole('heading', { name: 'Strength progression' }).waitFor()

    /**
     * Pick the subject explicitly rather than asserting which one is offered first.
     * The default is whichever exercise has the most logged days, so any session left
     * behind by another suite or by the sweep changes it — this asserted `Lat Pulldown`
     * and got `Plank` once leftover sweep sessions had logged three planks.
     */
    await page.getByLabel('Exercise').click()
    await page.getByRole('option', { name: 'Lateral Raises', exact: true }).click()

    // One line, labelled with the gym it happened at — not a single line spanning both.
    await expect(page.getByText('Current gym', { exact: true }).first()).toBeVisible()
    // 15 kg × 12 → 21 kg estimated; the chart states its best rather than only drawing it.
    await expect(page.getByText('kg e1RM')).toBeVisible()
    await expect(page.getByLabel(/readings from 10 kg × 12 .* to 15 kg × 12/)).toBeVisible()
  })

  test('priority adherence answers whether the ranked order got the volume', async ({ page }) => {
    await page.goto(`/trends?k=${TOKEN}`)
    await page.getByRole('heading', { name: 'Priority adherence' }).waitFor()

    // Rank 1 is shoulders (side) — the seeded lateral raises. Back is rank 2.
    await expect(page.getByText('Shoulders (side)', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/Volume matches your priority order|received the/)).toBeVisible()
  })

  test('session frequency shows which days, against the 4-day target', async ({ page }) => {
    await page.goto(`/trends?k=${TOKEN}`)
    await page.getByRole('heading', { name: 'Session frequency' }).waitFor()

    // Three sessions across two weeks never hits four, and the caption says so
    // instead of implying success.
    await expect(page.getByText(/of 12 weeks hit 4 ·/)).toBeVisible()
    await expect(page.getByLabel(/— 1 session$/).first()).toBeVisible()
  })
})
