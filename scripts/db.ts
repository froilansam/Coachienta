import pg from 'pg'

/**
 * DATE (oid 1082) must never become a JS Date.
 *
 * `pg` parses it at LOCAL midnight, so in Asia/Tokyo `2026-08-04` becomes
 * `2026-08-03T15:00Z` and any `toISOString()` silently reports the previous day.
 * A calendar day is not an instant — this is the exact defect class the whole
 * schema exists to prevent (PRD-001 §3.2).
 *
 * TIMESTAMPTZ (1184) is genuinely an instant and is left alone.
 */
pg.types.setTypeParser(1082, (v) => v)

export const connect = async () => {
  const connectionString = process.env.SUPABASE_DB_URL
  if (!connectionString) throw new Error('SUPABASE_DB_URL missing')
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  return client
}
