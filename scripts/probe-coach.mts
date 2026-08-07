/**
 * What the real coach actually answers, and whether its numbers match SQL.
 *
 * The exit criteria for P4 are two specific questions (PRD-000 §"P4"), and AC-3.1 says
 * the protein answer must match `AVG()` over the same range EXACTLY. That is checkable
 * here and nowhere else — a stubbed model proves nothing about it.
 *
 *   npm run probe:coach "what was my average protein last week"
 */
const TOKEN = process.env.APP_ACCESS_TOKEN
const BASE = process.env.SWEEP_URL ?? 'http://localhost:3000'
const questions = process.argv.slice(2)

if (!TOKEN) throw new Error('APP_ACCESS_TOKEN missing — run with --env-file=.env.local')
if (questions.length === 0) {
  console.log('usage: npm run probe:coach "what was my average protein last week"')
  process.exit(1)
}

const unlock = await fetch(`${BASE}/?k=${TOKEN}`, { redirect: 'manual' })
const cookie = (unlock.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
if (!cookie) throw new Error(`no access cookie from ${BASE} — is the server up?`)

for (const question of questions) {
  const started = Date.now()
  const res = await fetch(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      messages: [{ id: 'q1', role: 'user', parts: [{ type: 'text', text: question }] }],
    }),
  })

  console.log(`\n${'─'.repeat(74)}\n"${question}"  →  ${res.status}`)
  if (!res.ok || !res.body) {
    console.log('  ✗', (await res.text()).slice(0, 300))
    continue
  }

  // The UI message stream is SSE-framed `data: {...}` lines.
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let firstToken = 0
  const calls: string[] = []

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw === '' || raw === '[DONE]') continue
      let part: Record<string, unknown>
      try { part = JSON.parse(raw) } catch { continue }
      if (part.type === 'text-delta' && typeof part.delta === 'string') {
        if (!firstToken && part.delta.trim()) firstToken = Date.now() - started
        text += part.delta
      }
      if (part.type === 'tool-input-available') {
        calls.push(`${String(part.toolName)}(${JSON.stringify(part.input)})`)
      }
      if (part.type === 'error') console.log('  ⚠ stream error:', String(part.errorText).slice(0, 200))
    }
  }

  console.log(`  first token ${firstToken}ms · total ${Date.now() - started}ms`)
  console.log(`  tools: ${calls.length === 0 ? 'NONE — it answered without data' : calls.join('  ')}`)
  console.log(`\n${text.trim().split('\n').map((l) => `  ${l}`).join('\n')}`)
}
