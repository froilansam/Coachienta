/**
 * Ask the real model what is in a real photo, and print it.
 *
 *   npx tsx scripts/probe-vision.mts ~/Downloads/lunch.jpg
 *
 * The E2E suite stubs vision on purpose — it tests that the review screen never
 * writes on its own, which needs a fixed set of items. Nothing in that suite can
 * tell you whether the model is any GOOD at reading a plate. Only a real photo
 * can, and only a human can judge the answer. That is what this is for.
 *
 * It reports token cost too, because images are the expensive part of the free
 * tier: a 64×64 PNG measured 1,089 prompt tokens.
 */
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { loadEnvConfig } from '@next/env'

loadEnvConfig(process.cwd())

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
}

const path = process.argv[2]
if (!path) {
  console.error('Usage: npx tsx scripts/probe-vision.mts <path-to-photo>')
  process.exit(1)
}

const ext = extname(path).toLowerCase()
const mimeType = MIME[ext]
if (!mimeType) {
  console.error(`Unsupported extension "${ext}". Try ${Object.keys(MIME).join(', ')}.`)
  process.exit(1)
}

const bytes = await readFile(path)
console.log(`${basename(path)} — ${(bytes.length / 1024).toFixed(0)} KB, ${mimeType}`)
console.log('Sent full size. The app downscales to 1024px first, so real cost is lower.\n')

const { resolvePhoto } = await import('../lib/ai/resolvePhoto')
const started = process.hrtime.bigint()
const result = await resolvePhoto(bytes.toString('base64'), mimeType)
const ms = Number(process.hrtime.bigint() - started) / 1e6

if (result.error) {
  console.error(`FAILED after ${ms.toFixed(0)} ms: ${result.error}`)
  process.exit(1)
}

console.log(`Answered in ${(ms / 1000).toFixed(1)}s${result.degraded ? ' (fallback provider)' : ''}`)
console.log(`Read as: ${result.kind.toUpperCase()}`)
if (result.sceneNotes) console.log(`Notes: ${result.sceneNotes}`)
console.log()

if (result.kind === 'label' && result.label) {
  const { readLabel, describeLabel } = await import('../lib/domain/food/label')
  const label = result.label
  console.log(`Product: ${label.product_name ?? '(none)'}${label.brand ? ` — ${label.brand}` : ''}`)
  console.log(`Regime: ${label.regime}${label.language ? `, ${label.language}` : ''}`)
  if (label.unreadable_notes) console.log(`Could not read: ${label.unreadable_notes}`)

  console.log('\nTranscribed columns:')
  for (const c of label.columns) {
    console.log(`  per ${c.basis_amount} ${c.basis_unit}${c.basis_mass ? ` (${c.basis_mass} g/ml)` : ''}`)
    console.log(
      `    kcal ${c.kcal}  P ${c.protein_g}  F ${c.fat_g}  ` +
        `carb ${c.carbohydrate_g ?? '—'}  net ${c.net_carbs_g ?? '—'}  ` +
        `fibre ${c.fiber_g ?? '—'}  sugars ${c.sugars_g ?? '—'}  salt ${c.salt_g ?? '—'}`,
    )
  }

  // The arithmetic is pure and runs here too, so you see exactly what the app
  // would store — not a second opinion from the model.
  const read = readLabel(label)
  if (!read) {
    console.log('\nNo carbohydrate figure recoverable — the app would ask you to type it.')
  } else {
    const d = describeLabel(label, read.verdict, read.rate)
    console.log(`\nStored as: ${d.basisLabel}`)
    console.log(
      `  kcal ${read.rate.kcal}  P ${read.rate.protein_g}  ` +
        `C ${read.rate.carbs_g}  F ${read.rate.fat_g}  fibre ${read.rate.fiber_g ?? '—'}`,
    )
    console.log(`Carbs from: ${read.verdict.carbs_basis}`)
    console.log(`Verdict: ${d.verdict.headline} — ${d.verdict.detail ?? ''}`)
    console.log(`Confidence: ${read.verdict.confidence}`)
    for (const n of d.notes) console.log(`  note: ${n}`)
  }

  console.log('\nCheck the transcription against the packet, digit by digit. The maths')
  console.log('above is pure and deterministic — only the reading can be wrong.')
} else {
  console.log(`Dish: ${result.dishName ?? '(none)'}`)
  for (const item of result.items) {
    console.log(`  ${item.name}`)
    console.log(`    ${item.estimated_amount} ${item.estimated_unit}  [${item.confidence}]`)
    console.log(`    why: ${item.portion_reasoning}`)
  }
  if (result.items.length === 0) console.log('  (no food identified)')

  console.log('\nJudge it yourself: are the NAMES right? The amounts are expected to be')
  console.log('rough — the app makes grams the editable field precisely because of that.')
}
