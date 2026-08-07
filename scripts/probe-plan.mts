/**
 * What the real model actually builds from a real prompt.
 *
 * Plan QUALITY cannot be asserted in CI, for the same reason vision accuracy cannot
 * (PRD-004 §6): whether `Upper Body` produced a sensible session is a judgement. The
 * E2E suite proves the mechanical claims — no invented exercises, criticals enforced,
 * nothing written — and this script is the human check on top.
 *
 *   npm run probe:plan "Upper Body"
 */
const TOKEN = process.env.APP_ACCESS_TOKEN
const BASE = process.env.SWEEP_URL ?? 'http://localhost:3000'
const prompts = process.argv.slice(2)

if (!TOKEN) throw new Error('APP_ACCESS_TOKEN missing — run with --env-file=.env.local')
if (prompts.length === 0) {
  console.log('usage: npm run probe:plan "PULL LEGS!" ["Upper Body" ...]')
  process.exit(1)
}

const unlock = await fetch(`${BASE}/?k=${TOKEN}`, { redirect: 'manual' })
const cookie = (unlock.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
if (!cookie) throw new Error(`no access cookie from ${BASE} — is the server up?`)

for (const prompt of prompts) {
  const started = Date.now()
  const res = await fetch(`${BASE}/api/ai/plan-workout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ prompt, gym_id: null }),
  })
  const raw = await res.text()
  console.log(`\n${'─'.repeat(72)}\n"${prompt}"  →  ${res.status} in ${Date.now() - started}ms`)
  if (raw.trim() === '') {
    console.log('  ✗ empty response body')
    continue
  }
  const json = JSON.parse(raw)
  if (!res.ok) {
    console.log(`  ✗ ${json.error}`)
    continue
  }
  console.log(`  ${json.title}${json.degraded ? '   [FALLBACK MODEL]' : ''}`)
  console.log(`  ${json.rationale}`)
  if (json.notice) console.log(`  ⚠ ${json.notice}`)
  for (const [i, it] of json.items.entries()) {
    const range = `${it.rep_low}–${it.rep_high}`
    console.log(`   ${String(i + 1).padStart(2)}. ${it.name.padEnd(30)} ${it.target_sets}×${range.padEnd(7)} ${it.why ?? ''}`)
  }
}
