import { expect, test, type Page } from '@playwright/test'

/**
 * P4 — the coach surface (PRD-005 §3.8).
 *
 * **Stubbed, deliberately.** Whether the model gives a *good* answer is a judgement
 * (`npm run probe:coach` and a human), and the 70B's free tier is 100k tokens a day —
 * roughly 15 real turns — so a suite that spent them would exhaust the day's budget and
 * still assert nothing reliable. What IS assertable is the surface, and specifically the
 * one non-negotiable in this feature: **every numeric claim shows the queries behind it**
 * (§3.6, AC-3.4). That is the trust feature, and it is pure rendering of the tool calls.
 *
 * The stream fixture uses the SDK's real chunk shapes, read from `ai`'s own types rather
 * than guessed — a hand-written fixture the client silently rejects would look exactly
 * like a broken product (the lesson from the hand-typed PNG in the photo tests).
 */
const TOKEN = process.env.APP_ACCESS_TOKEN!

interface StubOptions {
  text: string
  tools?: Array<{ name: string; input: Record<string, unknown>; output: Record<string, unknown> }>
  degraded?: boolean
  model?: string
}

/** One SSE-framed UI message stream, in the order the real route emits it. */
function streamBody({ text, tools = [], degraded = false, model = 'llama-3.3-70b-versatile' }: StubOptions) {
  const parts: Array<Record<string, unknown>> = [{ type: 'start' }, { type: 'start-step' }]

  for (const [i, t] of tools.entries()) {
    const toolCallId = `call-${i}`
    parts.push({ type: 'tool-input-available', toolCallId, toolName: t.name, input: t.input })
    parts.push({ type: 'tool-output-available', toolCallId, output: t.output })
  }

  parts.push({ type: 'text-start', id: 't0' })
  // Delta by word, so a streaming render is exercised rather than one atomic write.
  for (const word of text.split(' ')) {
    parts.push({ type: 'text-delta', id: 't0', delta: `${word} ` })
  }
  parts.push({ type: 'text-end', id: 't0' })
  parts.push({ type: 'message-metadata', messageMetadata: { model, degraded, droppedTurns: 0 } })
  parts.push({ type: 'finish-step' })
  parts.push({ type: 'finish' })

  return `${parts.map((p) => `data: ${JSON.stringify(p)}\n\n`).join('')}data: [DONE]\n\n`
}

const AVERAGES = {
  name: 'get_nutrition_averages',
  input: { start_date: '2026-07-30', end_date: '2026-08-05' },
  output: { row_count: 7, logged_days: 7, protein_mean: 171.4, protein_target: 160 },
}

/**
 * `page.route` stops intercepting once the Serwist service worker takes control of a
 * `next start` build — it has bitten three times now.
 */
test.use({ serviceWorkers: 'block' })

const stub = (page: Page, options: StubOptions) =>
  page.route('**/api/ai/chat', (r) =>
    r.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      body: streamBody(options),
    }),
  )

const open = async (page: Page) => {
  await page.goto(`/coach?k=${TOKEN}`)
  await page.getByRole('heading', { name: 'Coach', exact: true }).waitFor()
}

const ask = async (page: Page, text: string) => {
  await page.getByLabel('Ask Coachienta').fill(text)
  await page.getByRole('button', { name: 'Send' }).click()
}

// ---------------------------------------------------------------------------
test('the empty state says what the coach can do, with real openers', async ({ page }) => {
  await open(page)

  await expect(page.getByText('ASK ABOUT YOUR NUMBERS')).toBeVisible()
  // Alma's honesty pattern: it explains the basis of every answer before inviting one.
  await expect(page.getByText(/averages over every row, not a sample/)).toBeVisible()
  // Openers, not a static "try asking…" — these are the questions P4 exists to answer.
  await expect(page.getByRole('button', { name: 'What was my average protein last week?' })).toBeVisible()
})

test('the disclaimer is always visible, never dismissible', async ({ page }) => {
  await open(page)
  // Required given the post-op constraint. A disclaimer you have dismissed is not one.
  await expect(page.getByText(/Not medical advice/)).toBeVisible()
  await stub(page, { text: 'Fine.' })
  await ask(page, 'hello')
  await expect(page.getByText(/Not medical advice/)).toBeVisible()
})

test('AC-3.4 — a numeric answer shows the queries and the range they covered', async ({ page }) => {
  await stub(page, {
    text: 'Across **7 logged days** you averaged **171.4 g** protein against a **160 g** target.',
    tools: [AVERAGES],
  })
  await open(page)
  await ask(page, 'what was my average protein last week')

  await expect(page.getByText(/you averaged/)).toBeVisible()

  // Collapsed by default — provenance sits at the point of the claim, not in a settings
  // screen, and not open by default where it would bury the answer.
  const panel = page.getByRole('button', { name: 'DATA USED (1)' })
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('aria-expanded', 'false')

  await panel.click()
  await expect(page.getByText('Nutrition averages')).toBeVisible()
  /**
   * The range is the part worth auditing: asked twice for "last week" the real model
   * chose two different seven-day windows. Both were defensible; both needed stating.
   */
  await expect(page.getByText('2026-07-30 → 2026-08-05')).toBeVisible()
  // Scoped to the panel: the ANSWER also says "7 logged days", which is the point —
  // the prose and the receipt agree — but it makes a bare text match ambiguous.
  await expect(page.getByText('7 logged days').last()).toBeVisible()
  // And which model answered, since the fallback has different judgement.
  await expect(page.getByText(/Answered by llama-3.3-70b-versatile/)).toBeVisible()
})

test('the numbers the coach bolds are rendered bold, not as asterisks', async ({ page }) => {
  await stub(page, { text: 'You averaged **171.4 g** protein.', tools: [AVERAGES] })
  await open(page)
  await ask(page, 'protein')

  await expect(page.locator('strong', { hasText: '171.4 g' })).toBeVisible()
  // The markers themselves must never reach the screen.
  await expect(page.getByText('**')).toHaveCount(0)
})

test('AC-3.13 — an empty range reads as an answer, not a failure', async ({ page }) => {
  await stub(page, {
    text: 'You have no nutrition logged in March 2026.',
    tools: [
      {
        name: 'get_nutrition_averages',
        input: { start_date: '2026-03-01', end_date: '2026-03-31' },
        output: { row_count: 0, logged_days: 0 },
      },
    ],
  })
  await open(page)
  await ask(page, 'how did I eat in March')

  await expect(page.getByText(/no nutrition logged in March/)).toBeVisible()
  await page.getByRole('button', { name: 'DATA USED (1)' }).click()
  // `no data`, not `0 rows` — the absence is the finding.
  await expect(page.getByText('no data', { exact: true })).toBeVisible()
})

test('AC-3.9 — a fallback answer says so', async ({ page }) => {
  await stub(page, {
    text: 'Answered on the backup model.',
    tools: [AVERAGES],
    degraded: true,
    model: 'gemini-3.6-flash',
  })
  await open(page)
  await ask(page, 'protein')

  // Quietly, but visibly: a different model has different judgement.
  await expect(page.getByText('FALLBACK MODEL')).toBeVisible()
})

test('follow-up chips come from the tool that ran, not a fixed list', async ({ page }) => {
  await stub(page, { text: 'Averaged **171.4 g**.', tools: [AVERAGES] })
  await open(page)
  await ask(page, 'protein')
  await expect(page.getByText(/Averaged/)).toBeVisible()

  // A nutrition answer offers a nutrition follow-up; the openers are gone.
  await expect(page.getByRole('button', { name: 'What about my carbs?' })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'What was my average protein last week?' }),
  ).toHaveCount(0)
})

test('a chip asks its question without retyping it', async ({ page }) => {
  await stub(page, { text: 'Here you go.' })
  await open(page)
  await page.getByRole('button', { name: 'What was my average protein last week?' }).click()

  // Sent as a user message — and no longer offered as a chip, so this is unambiguous.
  await expect(page.locator('p.bg-sunk', { hasText: 'average protein last week' })).toBeVisible()
  await expect(page.getByText('Here you go.')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'What was my average protein last week?' }),
  ).toHaveCount(0)
})

test('AC-3.10 — with the coach unavailable, the rest of the app still works', async ({ page }) => {
  await page.route('**/api/ai/chat', (r) =>
    r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Out of AI quota for the moment. Try again later, or use a template.' }) }),
  )
  await open(page)
  await ask(page, 'protein')

  // A named state with a way out, not a spinner that never resolves.
  await expect(page.getByRole('button', { name: 'TRY AGAIN' })).toBeVisible()

  // The whole point of AC-3.10: the app is not the coach.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

test('NEW clears the thread', async ({ page }) => {
  await stub(page, { text: 'First answer.' })
  await open(page)
  await ask(page, 'hello')
  await expect(page.getByText('First answer.')).toBeVisible()

  await page.getByRole('button', { name: 'NEW' }).click()
  await expect(page.getByText('First answer.')).toHaveCount(0)
  await expect(page.getByText('ASK ABOUT YOUR NUMBERS')).toBeVisible()
})

test('the user message is bubbled and the answer is not', async ({ page }) => {
  await stub(page, { text: 'A long numeric analysis reads as a document, not a chat blob.' })
  await open(page)
  await ask(page, 'my question')

  /**
   * §3.8's central decision. Asserted structurally rather than by screenshot: the user's
   * text sits in an element with the sunk background, the assistant's does not.
   */
  const bubble = page.locator('p.bg-sunk', { hasText: 'my question' })
  await expect(bubble).toBeVisible()
  await expect(page.locator('p.bg-sunk', { hasText: 'reads as a document' })).toHaveCount(0)
  await expect(page.getByText('reads as a document')).toBeVisible()
})

// ---------------------------------------------------------------------------
// US-3.7 — choosing which quota to spend
// ---------------------------------------------------------------------------
test('the model picker shows what each pool has left, and a spent one cannot be chosen', async ({
  page,
}) => {
  await page.route('**/api/ai/models', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        options: [
          {
            choice: 'chat',
            id: 'llama-3.3-70b-versatile',
            label: 'Balanced',
            note: 'Best at choosing the right query.',
            quota: { kind: 'tokens', used: 62_400, cap: 100_000 },
          },
          {
            choice: 'chatFallback',
            id: 'gemini-3.6-flash',
            label: 'Backup',
            note: 'Shares its 20 daily calls with photo logging.',
            quota: { kind: 'requests', used: 20, cap: 20 },
          },
          {
            choice: 'cheap',
            id: 'llama-3.1-8b-instant',
            label: 'Light',
            note: 'Near-unlimited, weaker at picking queries.',
            quota: { kind: 'tokens', used: 1_200, cap: 500_000 },
          },
        ],
      }),
    }),
  )
  await open(page)

  await page.getByRole('button', { name: /Change model/ }).click()

  // The figures are the feature: the reason to switch is that a pool is nearly gone.
  await expect(page.getByText('62,400 / 100,000 tokens')).toBeVisible()
  await expect(page.getByText('1,200 / 500,000 tokens')).toBeVisible()
  // A spent pool is shown and disabled, not hidden — it will be back tomorrow.
  await expect(page.getByRole('button', { name: /Backup/ })).toBeDisabled()
  await expect(page.getByText('spent for today')).toBeVisible()
})

test('US-3.7 — the chosen model is sent with the question and survives a reload', async ({
  page,
}) => {
  const sent: string[] = []
  await page.route('**/api/ai/chat', async (r) => {
    const body = r.request().postDataJSON() as { model?: string }
    sent.push(body.model ?? 'none')
    await r.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
      body: streamBody({ text: 'Fine.' }),
    })
  })
  await open(page)

  // Default is the balanced model.
  await ask(page, 'first question')
  await expect(page.getByText('Fine.')).toBeVisible()
  expect(sent[0]).toBe('chat')

  await page.getByRole('button', { name: /Change model/ }).click()
  await page.getByRole('button', { name: /Light/ }).click()
  await ask(page, 'second question')
  await expect.poll(() => sent.length).toBe(2)
  // Switching applies to the NEXT message without resetting the thread.
  expect(sent[1]).toBe('cheap')
  await expect(page.getByText('first question')).toBeVisible()

  // The reason to switch outlives a reload, so the choice must too.
  await page.reload()
  await expect(page.getByRole('button', { name: /Model: Light/ })).toBeVisible()
})
