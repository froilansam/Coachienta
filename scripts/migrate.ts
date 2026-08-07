/** Apply supabase/migrations/*.sql in order. Idempotent — safe to re-run. */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import 'dotenv/config'
import { connect } from './db'

const dir = join(process.cwd(), 'supabase/migrations')

async function main() {
  const c = await connect()
  try {
    await c.query(`create table if not exists _migrations (
      name text primary key, applied_at timestamptz not null default now())`)

    const applied = new Set(
      (await c.query<{ name: string }>('select name from _migrations')).rows.map((r) => r.name),
    )

    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (applied.has(file)) { console.log(`· ${file} (already applied)`); continue }
      console.log(`▸ ${file}`)
      await c.query('begin')
      try {
        await c.query(readFileSync(join(dir, file), 'utf8'))
        await c.query('insert into _migrations (name) values ($1)', [file])
        await c.query('commit')
        console.log(`✓ ${file}`)
      } catch (e) {
        await c.query('rollback')
        throw e
      }
    }
  } finally {
    await c.end()
  }
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
