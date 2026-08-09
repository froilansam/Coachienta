import { connect } from '../scripts/db'

/**
 * One database connection per worker, shared by every assertion.
 *
 * Replaces a `withDb` that was copy-pasted into five specs and opened a **fresh
 * connection per call**. At 119 tests, each polling several times for a queued write to
 * land, that is hundreds of connections to Supabase's session pooler — and late in a run
 * the pooler starts refusing them. The symptom was a different queued-write test timing
 * out on each full run while every one of them passed in isolation, which reads exactly
 * like a product bug and is not one.
 *
 * Reconnects once on a failed query, so a connection dropped mid-suite costs one retry
 * rather than every remaining test.
 */
type Client = Awaited<ReturnType<typeof connect>>

let client: Client | null = null

async function current(): Promise<Client> {
  if (client === null) client = await connect()
  return client
}

export async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  try {
    return await fn(await current())
  } catch (err) {
    // The pooler closes idle connections; one retry on a fresh one is enough.
    await client?.end().catch(() => {})
    client = null
    if (err instanceof Error && /connection|terminated|socket|ECONN/i.test(err.message)) {
      return fn(await current())
    }
    throw err
  }
}

/** Closes the shared connection so the worker can exit. */
export async function closeDb(): Promise<void> {
  await client?.end().catch(() => {})
  client = null
}

/**
 * Drop the day-plans a test created, and only those.
 *
 * START SESSION copies its template, and the copy inherits the template's name — so a
 * test's plan carries no `ZZTest` mark and cannot be identified the way its sessions can.
 * Five specs therefore swept `where not is_template`, which was fine only while the
 * database held no real sessions. It no longer does: that statement now hits a plan a
 * real session references, `workout_sessions_plan_id_fkey` is ON DELETE NO ACTION, and
 * the cleanup raises — taking every test in the file with it.
 *
 * Unreferenced is the right test. Each caller deletes its own sessions first, so by the
 * time this runs a test's plan is orphaned and a real one is still spoken for. The
 * `plan_id is not null` guard matters: without it a single NULL makes `not in` return
 * NULL for every row and the delete quietly does nothing.
 */
export const dropUnreferencedPlans = () =>
  withDb(async (c) => {
    const orphans = `select id from workout_plans where not is_template
                       and id not in (select plan_id from workout_sessions where plan_id is not null)`
    await c.query(`delete from plan_exercises where plan_id in (${orphans})`)
    await c.query(`delete from workout_plans where id in (${orphans})`)
  })
