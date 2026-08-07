/**
 * Drives the real flows in a browser against `next dev` and reports every
 * console error, warning and unhandled rejection.
 *
 * Runs against DEV on purpose: StrictMode double-invokes effects and state
 * updaters there, and `next start` hides exactly the class of bug that produced
 * the duplicate-key error (impure state updater in useLogDraft).
 *
 *   npx tsx --env-file=.env.local scripts/console-sweep.mts
 */
import { chromium, type ConsoleMessage, type Page } from '@playwright/test'

const BASE = process.env.SWEEP_URL ?? 'http://127.0.0.1:3300'
const TOKEN = process.env.APP_ACCESS_TOKEN!

/** Valid 8×8 PNG — `createImageBitmap` really decodes it, so it must be sound. */
const SWEEP_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGM4UWGDFTEMLQkAQfNfAVTFtrMAAAAASUVORK5CYII=',
  'base64',
)


interface Finding {
  where: string
  type: string
  text: string
}

const findings: Finding[] = []
let where = 'boot'

/** Dev-server noise that is not ours and not actionable. */
const IGNORE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /webpack-hmr|turbopack-hmr/i,
]

function record(type: string, text: string) {
  if (IGNORE.some((re) => re.test(text))) return
  // Script failures carry a Playwright call log that explains WHY a click
  // stalled; truncating it to 300 chars threw away the only useful part.
  findings.push({ where, type, text: text.slice(0, type === 'script' ? 1600 : 300) })
}

function attach(page: Page) {
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' || m.type() === 'warning') record(m.type(), m.text())
  })
  page.on('pageerror', (e) => record('pageerror', e.message))
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText ?? ''
    if (!/ERR_ABORTED/.test(f)) record('requestfailed', `${r.method()} ${r.url()} — ${f}`)
  })
}

const step = async (name: string, fn: () => Promise<void>) => {
  where = name
  process.stdout.write(`  · ${name}\n`)
  await fn()
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
attach(page)

try {
  await step('unlock + today', async () => {
    await page.goto(`${BASE}/?k=${TOKEN}`, { waitUntil: 'networkidle' })
    await page.getByRole('navigation', { name: 'Main' }).waitFor()
  })

  await step('day navigation', async () => {
    // Back a day, into a day with real entries, then a day before any target
    // exists, then the TODAY jump. Every one of these re-renders the whole screen.
    await page.getByRole('button', { name: 'Previous day' }).click()
    await page.waitForTimeout(900)
    await page.getByRole('button', { name: 'Previous day' }).click()
    await page.waitForTimeout(900)
    await page.getByRole('button', { name: 'Next day' }).click()
    await page.waitForTimeout(900)
    await page.getByRole('button', { name: 'Today' }).click()
    await page.waitForTimeout(900)
  })

  await step('open log sheet', async () => {
    await page.getByRole('button', { name: /LOG FOOD/ }).first().click()
    await page.getByLabel('Search foods').waitFor()
  })

  await step('recent foods render', async () => {
    await page.getByRole('button', { name: /White rice \(cooked\)/ }).first().waitFor()
  })

  await step('search a library food', async () => {
    await page.getByLabel('Search foods').fill('white rice')
    await page.waitForTimeout(900)
  })

  await step('portion editor + sources', async () => {
    await page.getByRole('button', { name: /White rice \(cooked\)/ }).first().click()
    await page.getByRole('button', { name: 'ADD' }).waitFor()
  })

  await step('stepper + presets', async () => {
    await page.getByRole('button', { name: 'Increase Amount in g' }).click()
    await page.getByRole('button', { name: 'Decrease Amount in g' }).click()
    const preset = page.getByRole('button', { name: '250', exact: true })
    if (await preset.count()) await preset.first().click()
  })

  await step('add to basket', async () => {
    await page.getByRole('button', { name: 'ADD' }).click()
    await page.getByRole('button', { name: /LOG 1 ITEM/ }).waitFor()
  })

  await step('add a second, different food', async () => {
    await page.getByLabel('Search foods').fill('sunny side up')
    await page.waitForTimeout(900)
    await page.getByRole('button', { name: /Sunny side up eggs/ }).first().click()
    await page.getByRole('button', { name: 'ADD' }).click()
    await page.getByRole('button', { name: /LOG 2 ITEMS/ }).waitFor()
  })

  await step('add the SAME food twice (duplicate-key repro)', async () => {
    await page.getByLabel('Search foods').fill('white rice')
    await page.waitForTimeout(900)
    await page.getByRole('button', { name: /White rice \(cooked\)/ }).first().click()
    await page.getByRole('button', { name: 'ADD' }).click()
    await page.getByRole('button', { name: /LOG 3 ITEMS/ }).waitFor()
  })

  await step('remove a basket chip', async () => {
    await page.getByRole('button', { name: /^Remove / }).first().click()
  })

  await step('multi-item input', async () => {
    await page.getByLabel('Search foods').fill('200g tofu, 140g rice')
    await page.waitForTimeout(900)
  })

  await step('non-food rejection', async () => {
    await page.getByLabel('Search foods').fill('Nutrition planning session')
    await page.waitForTimeout(900)
  })

  await step('external lookup (USDA/OFF)', async () => {
    await page.getByLabel('Search foods').fill('100g raw broccoli')
    await page.waitForTimeout(3500)
  })

  await step('change meal + date', async () => {
    await page.getByLabel('Log date').fill('2026-08-05')
    await page.getByLabel('Meal').click()
    await page.getByRole('option', { name: 'Dinner' }).click()
  })

  /**
   * Photo review, with the vision call stubbed. Two reasons for the stub: the
   * free tier is a finite daily budget, and StrictMode is what we are here for —
   * the review list is a keyed map over editable rows, the exact shape that
   * produced the duplicate-key error in the basket.
   */
  await step('photo review (stubbed vision)', async () => {
    // Fetched from inside the page so it carries the unlock cookie the API needs.
    const rice = await page.evaluate(async () => {
      const r = await fetch('/api/data/resolve-food')
      const j = (await r.json()) as { results: Array<Record<string, unknown>> }
      return j.results.find((f) => String(f.name).startsWith('White rice')) ?? j.results[0]
    })
    if (!rice) throw new Error('sweep needs a library row to stub photo items with')

    await page.route('**/api/data/resolve-photo', (route) =>
      route.fulfill({
        json: {
          kind: 'plate',
          dishName: 'Sweep dish',
          label: null,
          sceneNotes: null,
          degraded: false,
          items: [0, 1, 2].map((n) => ({
            key: `k${n}`,
            name: 'White rice (cooked)',
            amount: 100 + n,
            unit: 'g',
            reasoning: 'Sweep item',
            visionConfidence: 'medium',
            // Same food three times on purpose — duplicate ids must not collide.
            food: rice,
          })),
        },
      }),
    )
    await page
      .getByLabel('Take a photo of food or a nutrition label')
      .setInputFiles({ name: 'sweep.png', mimeType: 'image/png', buffer: SWEEP_PNG })
    await page.getByText('AI-DETECTED ITEMS').waitFor({ timeout: 10_000 })
    await page.getByLabel('Amount of White rice (cooked) in g').first().fill('250')
    await page.getByLabel('Include White rice (cooked)').first().click()
    await page.getByRole('button', { name: /Remove White rice/ }).last().click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: /^ADD \d+ ITEM/ }).click()
    await page.waitForTimeout(500)
    await page.unroute('**/api/data/resolve-photo')
  })

  await step('commit', async () => {
    const log = page.getByRole('button', { name: /^LOG \d+ ITEM/ })
    if (await log.count()) {
      await log.click()
      await page.waitForTimeout(1500)
    }
  })

  await step('tab bar navigation', async () => {
    // 'Today' is omitted: Next's dev-only `nextjs-portal` indicator sits over
    // that corner in dev and blocks the click. Production coverage for all tabs
    // lives in e2e/today.spec.ts, including the toast-overlap regression.
    for (const t of ['Train', 'Coach', 'More']) {
      await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: t }).click()
      await page.waitForTimeout(400)
    }
  })

  /**
   * The library screen. Opens the editor, types in every numeric field, walks
   * into the merge picker and back out — without committing anything. StrictMode
   * is the point: the editor is a controlled form over a nested state object,
   * which is where an impure updater would show up.
   */
  await step('food library', async () => {
    await page.goto(`${BASE}/food/library`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Food library' }).waitFor()
    for (const f of ['CHECK', 'UNUSED', 'LABELS', 'ALL']) {
      await page.getByRole('radio', { name: new RegExp(`^${f}`) }).click()
      await page.waitForTimeout(500)
    }
    await page.getByLabel('Search your library').fill('rice')
    await page.waitForTimeout(600)
  })

  await step('library editor + merge picker', async () => {
    await page.getByRole('button', { name: /White rice/ }).first().click()
    await page.getByLabel('Calories').waitFor()
    // Type into the fields that drive the live check, then put them back.
    await page.getByLabel('Protein in grams').fill('9')
    await page.getByLabel('Fibre in grams').fill('2')
    await page.getByLabel('Basis amount').fill('100')
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'MERGE' }).click()
    await page.getByLabel('Find the other food').waitFor()
    await page.waitForTimeout(700)
    const candidate = page.getByRole('button', { name: /per 100 g/ }).first()
    if (await candidate.count()) {
      await candidate.click()
      await page.getByRole('radiogroup', { name: /survives/ }).waitFor()
      await page.getByRole('radio').nth(1).click()
      await page.waitForTimeout(300)
      await page.getByRole('button', { name: /Pick a different food/ }).click()
    }
    // Leave without writing anything.
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.waitForTimeout(300)
  })

  await step('source disclosure', async () => {
    // The provenance toggle, on both screens that show it.
    const t = page.getByRole('button', { name: /SOURCE/ }).first()
    if (await t.count()) {
      await t.click()
      await page.waitForTimeout(250)
      await t.click()
    }
  })

  await step('profile + weigh-in sheet', async () => {
    await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
    // `exact`: getByText is a case-insensitive substring match, and the footer
    // prose also contains "current".
    await page.getByText('CURRENT', { exact: true }).waitFor()
    for (const r of ['90D', '365D', '30D']) {
      await page.getByRole('radio', { name: r }).click()
      await page.waitForTimeout(350)
    }
    // Open the sheet and type in every field, then abandon it — no write.
    await page.getByRole('button', { name: 'LOG WEIGH-IN' }).click()
    await page.getByLabel('Weight in kilograms').fill('70.4')
    await page.getByLabel('Waist in centimetres').fill('79.8')
    await page.getByLabel('Body fat percentage').fill('19.2')
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.waitForTimeout(300)
  })

  /**
   * The goal editors. Every field is typed into and nothing is saved — the point
   * is StrictMode over three controlled forms and a live-recomputed findings list.
   */
  await step('goal editors (no writes)', async () => {
    await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
    await page.getByText('CURRENT', { exact: true }).waitFor()

    /**
     * Explicit waits before every click. Against `next dev` each sheet's first
     * open pays a compile, so a bare click can outrun the render — this walk is
     * about console output, not about racing the bundler.
     */
    const cancel = async () => {
      const b = page.getByRole('button', { name: 'Cancel' })
      await b.waitFor()
      await b.click()
      await page.getByRole('button', { name: 'Change' }).first().waitFor()
    }

    await page.getByRole('button', { name: 'Change' }).nth(1).click()
    await page.getByLabel('Gym day calorie low').waitFor()
    await page.getByLabel('Gym day calorie low').fill('1500')  // trips the floor
    await page.waitForTimeout(300)
    await page.getByLabel('Gym day calorie low').fill('2300')
    await page.getByLabel('Carbs gym low').fill('400')          // trips the ceiling
    await page.waitForTimeout(300)
    await cancel()

    await page.getByRole('button', { name: 'Change' }).first().click()
    await page.getByLabel('Target rate per week').waitFor()
    await page.getByLabel('Target rate per week').fill('0.25')
    await page.waitForTimeout(250)
    await cancel()

    await page.getByRole('button', { name: 'Add a coach rule' }).click()
    await page.getByLabel('Title').waitFor()
    await page.getByLabel('Title').fill('sweep rule')
    await page.getByLabel('Instruction').fill('sweep instruction')
    await page.getByRole('switch', { name: 'Critical' }).click()
    await page.waitForTimeout(250)
    await cancel()

    // Reorder, then put it back — a real write both ways, so StrictMode sees the
    // list rebuild twice.
    await page.getByRole('button', { name: 'Reorder' }).click()
    // The SECOND row's up button: row 1's is correctly disabled, being already first.
    const up = page.getByRole('button', { name: /Move .* up/ }).nth(1)
    await up.waitFor()
    await up.click()
    await page.waitForTimeout(250)
    await cancel()

    await page.getByRole('button', { name: 'PREVIEW COACH PROMPT' }).click()
    await page.getByRole('button', { name: 'DONE' }).waitFor()
    await page.waitForTimeout(400)
    /**
     * Escape, not a click on DONE. In dev, `<nextjs-portal>` — the build indicator —
     * sits over the bottom-left corner and intercepts pointer events, which is the
     * same reason the 'Today' tab is skipped above. Escape also exercises the
     * Sheet's dismissible path, so nothing is lost.
     */
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  })

  /**
   * The exercise library. Filters, both groupings, muscle chips, and the editor
   * opened and abandoned — StrictMode over a memoised 57-row list that re-audits
   * on every keystroke.
   */
  await step('exercise library', async () => {
    await page.goto(`${BASE}/train/exercises`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Exercises' }).waitFor()

    for (const f of ['NEEDS CHECK', 'RETIRED', 'ALL']) {
      await page.getByRole('radio', { name: new RegExp(`^${f}`) }).click()
      await page.waitForTimeout(300)
    }
    await page.getByRole('radio', { name: 'A–Z' }).click()
    await page.waitForTimeout(300)
    await page.getByRole('radio', { name: 'BY MUSCLE' }).click()

    await page.getByLabel('Search exercises').fill('press')
    await page.waitForTimeout(400)
    await page.getByLabel('Search exercises').fill('')

    // A muscle chip, then back to all.
    const chip = page.getByRole('button', { name: 'Chest', exact: true })
    if (await chip.count()) {
      await chip.first().click()
      await page.waitForTimeout(300)
      await page.getByRole('button', { name: 'ALL MUSCLES' }).click()
    }
  })

  await step('exercise editor (no writes)', async () => {
    await page.getByRole('button', { name: /^Chest Press Machine\b/ }).first().click()
    await page.getByLabel('Name').waitFor()
    // Open the two comboboxes and the load-type explainer, then abandon.
    await page.getByLabel('Load type').click()
    await page.getByRole('option', { name: 'Assisted' }).click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.waitForTimeout(300)
  })

  /**
   * The day plan. Loads a template, edits it, opens the picker — and never starts a
   * session, so the sweep writes nothing.
   */
  await step('day plan (no session started)', async () => {
    await page.goto(`${BASE}/train/plan`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'New session' }).waitFor()

    await page.getByLabel('Template').click()
    await page.getByRole('option', { name: 'Day 1 Push' }).click()
    await page.getByLabel('Sets for Lateral Raises').waitFor()

    // Editing, reordering, and an order violation the checker should report.
    await page.getByLabel('Sets for Lateral Raises').fill('5')
    await page.getByLabel('Highest reps for Lateral Raises').fill('20')
    await page.getByRole('button', { name: 'Move Chest Press Machine up' }).click()
    await page.getByRole('button', { name: 'Move Chest Press Machine up' }).click()
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Move Chest Press Machine down' }).click()
    await page.getByRole('button', { name: /^Remove Rope Tricep Pushdown/ }).click()
    await page.waitForTimeout(300)

    /**
     * The prompt row. BUILD is deliberately NOT clicked — the sweep runs on every
     * change and a real model call costs quota. The disabled → enabled transition is
     * what StrictMode could break here; the route itself is covered by
     * `e2e/ai-plan.spec.ts` and `npm run probe:plan`.
     */
    await page.getByLabel('Prompt').fill('short push, delts first')
    await page.waitForTimeout(200)
    await page.getByLabel('Prompt').fill('')
    await page.waitForTimeout(200)

    // The picker, reusing the library list in selection mode.
    await page.getByRole('button', { name: 'ADD EXERCISE' }).first().click()
    await page.getByLabel('Search exercises').fill('face')
    await page.waitForTimeout(500)
    const hit = page.getByRole('button', { name: /^Face Pulls/ }).first()
    if (await hit.count()) await hit.click()
    await page.getByRole('button', { name: /^DONE/ }).click()
    await page.waitForTimeout(300)

    await page.getByRole('button', { name: 'EMPTY' }).click()
    await page.waitForTimeout(300)
  })

  /**
   * The live session, end to end: start one, log a weighted set and a timed one,
   * open the rest overlay. This is the only sweep step that writes, deliberately —
   * the commit path is the screen's whole point and StrictMode over a table of
   * controlled inputs is exactly where a double-invoked updater would show.
   */
  await step('live session', async () => {
    await page.goto(`${BASE}/train/plan`, { waitUntil: 'networkidle' })
    await page.getByLabel('Template').click()
    await page.getByRole('option', { name: 'Day 3 Legs' }).click()
    await page.getByLabel('Session name').fill('ZZSweep session')
    await page.getByRole('button', { name: 'START SESSION' }).click()
    await page.waitForURL(/\/train\/session\//)

    await page.getByLabel(/KG for set 1 of Leg Press/).waitFor()
    await page.getByLabel(/KG for set 1 of Leg Press/).fill('100')
    await page.getByLabel(/Reps for set 1 of Leg Press/).fill('10')
    await page.getByRole('checkbox', { name: /Save set 1 of Leg Press/ }).click()
    await page.getByRole('checkbox', { name: /Set 1 saved/ }).first().waitFor()

    // The rest overlay, and its adjust controls.
    const timer = page.getByRole('timer')
    if (await timer.count()) {
      await page.getByRole('button', { name: '+15' }).click()
      await page.getByRole('button', { name: '−15' }).click()
      await page.getByRole('button', { name: 'SKIP' }).click()
    }

    // A timed set: seconds only, no weight column at all.
    await page.getByLabel(/Seconds for set 1 of Plank/).fill('45')
    await page.getByRole('checkbox', { name: /Save set 1 of Plank/ }).click()
    await page.waitForTimeout(400)

    // A warmup, and an extra set.
    await page.getByRole('button', { name: /Mark Leg Extension set 1 as warmup/ }).click()
    await page.getByRole('button', { name: 'ADD SET' }).first().click()
    await page.waitForTimeout(400)

    /**
     * Mid-session exercise editing (AC-2.23). Adding writes; removing is opened and
     * CANCELLED, because the sweep's session is about to be read by the history step
     * and a destructive confirm belongs in the E2E suite, which owns its fixtures.
     */
    await page.getByRole('button', { name: 'ADD EXERCISE' }).click()
    await page.getByLabel('Search exercises').fill('face')
    await page.waitForTimeout(500)
    const midHit = page.getByRole('button', { name: /^Face Pulls/ }).first()
    if (await midHit.count()) await midHit.click()
    await page.getByLabel(/KG for set 1 of Face Pulls/).waitFor()

    await page.getByRole('button', { name: /^Remove Face Pulls from this session/ }).click()
    await page.getByRole('button', { name: 'CANCEL' }).click()
    await page.waitForTimeout(300)

    await page.getByRole('button', { name: 'FINISH SESSION' }).click()
    await page.waitForTimeout(600)
  })

  /** Train home: the session list grouped by date, and its delete confirm. */
  await step('session history', async () => {
    await page.goto(`${BASE}/train`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Train' }).waitFor()
    const del = page.getByRole('button', { name: /^Delete ZZSweep session/ }).first()
    if (await del.count()) {
      await del.click()
      await page.getByRole('button', { name: 'CANCEL' }).click()
      await page.waitForTimeout(300)
    }
  })

  /** All six trend charts, both measures, and the exercise switch. */
  await step('trends', async () => {
    await page.goto(`${BASE}/trends`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Trends', exact: true }).waitFor()
    await page.waitForTimeout(600)

    const sets = page.getByRole('radio', { name: 'Sets' })
    if (await sets.count()) {
      await sets.click()
      await page.waitForTimeout(300)
      await page.getByRole('radio', { name: 'Volume' }).click()
    }
    // `exact`: getByRole name matching is a SUBSTRING match, and '4w' also matches '24w'.
    await page.getByRole('radio', { name: '4w', exact: true }).click()
    await page.waitForTimeout(600)
    await page.getByRole('radio', { name: '24w', exact: true }).click()
    await page.waitForTimeout(600)

    const picker = page.getByLabel('Exercise')
    if (await picker.count()) {
      await picker.click()
      await page.getByRole('option').last().click()
      await page.waitForTimeout(400)
    }
  })

  /**
   * The coach surface. The route is STUBBED — a real turn costs ~6.5k of a 100k daily
   * budget, and the sweep runs on every change. Answer quality is `npm run probe:coach`
   * and a human; this checks the surface renders and streams without console faults.
   */
  await step('coach', async () => {
    const parts: Array<Record<string, unknown>> = [
      { type: 'start' },
      { type: 'start-step' },
      {
        type: 'tool-input-available',
        toolCallId: 'c0',
        toolName: 'get_nutrition_averages',
        input: { start_date: '2026-07-30', end_date: '2026-08-05' },
      },
      { type: 'tool-output-available', toolCallId: 'c0', output: { row_count: 7, logged_days: 7 } },
      { type: 'text-start', id: 't0' },
    ]
    for (const word of 'Across **7 logged days** you averaged **171.4 g** protein.'.split(' ')) {
      parts.push({ type: 'text-delta', id: 't0', delta: `${word} ` })
    }
    parts.push(
      { type: 'text-end', id: 't0' },
      { type: 'message-metadata', messageMetadata: { model: 'llama-3.3-70b-versatile', degraded: false } },
      { type: 'finish-step' },
      { type: 'finish' },
    )
    const body = `${parts.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('')}data: [DONE]\n\n`

    await page.route('**/api/ai/chat', (r) =>
      r.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
        body,
      }),
    )

    await page.goto(`${BASE}/coach`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Coach', exact: true }).waitFor()

    // An opener chip, then the receipt, then a fresh thread.
    await page.getByRole('button', { name: /average protein last week/ }).click()
    await page.getByText(/you averaged/).waitFor()
    await page.getByRole('button', { name: /DATA USED/ }).click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: 'NEW' }).click()
    await page.waitForTimeout(300)
    await page.unroute('**/api/ai/chat')
  })

  await step('dev/ui gallery', async () => {
    await page.goto(`${BASE}/dev/ui`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Open log sheet' }).click()
    await page.waitForTimeout(500)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Open keypad' }).click()
    await page.waitForTimeout(400)
    await page.keyboard.press('Escape')
    await page.getByRole('radio', { name: 'Dark' }).click()
    await page.waitForTimeout(400)
  })

  await step('dark-theme today', async () => {
    await page.goto(`${BASE}/today`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
  })
} catch (err) {
  // Keep the call log's first lines: "Timeout exceeded" alone does not say WHICH
  // locator stalled, which is the only thing worth knowing here.
  record('script', err instanceof Error ? err.message.split('\n').slice(0, 14).join(' | ') : String(err))
} finally {
  await browser.close()
}

console.log(`\n${'═'.repeat(72)}`)
if (findings.length === 0) {
  console.log('✅ no console errors, warnings or failed requests')
} else {
  const byText = new Map<string, Finding & { count: number }>()
  for (const f of findings) {
    const key = `${f.type}|${f.text}`
    const prev = byText.get(key)
    if (prev) prev.count++
    else byText.set(key, { ...f, count: 1 })
  }
  console.log(`❌ ${byText.size} distinct issue(s) across ${findings.length} occurrence(s)\n`)
  for (const f of byText.values()) {
    console.log(`  [${f.type}] ×${f.count}  during: ${f.where}`)
    console.log(`    ${f.text.replace(/\n/g, '\n    ')}\n`)
  }
}
process.exit(findings.length === 0 ? 0 : 1)
