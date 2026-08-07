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
