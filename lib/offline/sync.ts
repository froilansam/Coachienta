import { local, type QueuedMutation } from './db'

const MAX_RETRIES = 5

/** Queue a write and return immediately. The UI never waits on the network. */
export async function enqueue(
  m: Omit<QueuedMutation, 'createdAt' | 'retryCount' | 'state'>,
  mirror?: { day: string; data: unknown },
): Promise<void> {
  await local.transaction('rw', local.queue, local.rows, async () => {
    await local.queue.put({ ...m, createdAt: Date.now(), retryCount: 0, state: 'pending' })
    if (mirror) {
      await local.rows.put({ id: m.id, table: m.table, day: mirror.day, data: mirror.data, state: 'pending' })
    }
  })
  void flush()
}

let running = false

/**
 * Push pending mutations. Safe to call as often as we like — it self-guards.
 *
 * iOS Safari has no Background Sync API, so there is no "finish this later while
 * closed". Every trigger below is a foreground event (PRD-001 §4.2).
 */
export async function flush(): Promise<void> {
  if (running || typeof navigator === 'undefined' || !navigator.onLine) return
  running = true
  try {
    const pending = await local.queue.where('state').equals('pending').sortBy('createdAt')
    for (const m of pending) {
      try {
        const res = await fetch('/api/data/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(m),
        })
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)

        await local.transaction('rw', local.queue, local.rows, async () => {
          await local.queue.delete(m.id)
          await local.rows.update(m.id, { state: 'synced' })
        })
        window.dispatchEvent(new CustomEvent(SYNCED_EVENT, { detail: { table: m.table } }))
      } catch (err) {
        const retryCount = m.retryCount + 1
        await local.queue.update(m.id, {
          retryCount,
          lastError: err instanceof Error ? err.message : String(err),
          // Never silently dropped — a failed row stays visible in the header count.
          state: retryCount >= MAX_RETRIES ? 'failed' : 'pending',
        })
        break // stop on first failure; order matters and the network is likely down
      }
    }
  } finally {
    running = false
  }
}

/** Call once from a client provider on mount. */
export function startSync(): () => void {
  const onVisible = () => { if (document.visibilityState === 'visible') void flush() }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', () => void flush())
  void flush()
  return () => document.removeEventListener('visibilitychange', onVisible)
}

/**
 * Fired after a mutation reaches the server. Consumers refetch on this rather
 * than guessing when the queue has drained.
 *
 * Without it, deleting raced its own refetch: the queue entry was gone but the
 * server response still contained the row, so it reappeared.
 */
export const SYNCED_EVENT = 'coachienta:synced'

export const pendingCount = () => local.queue.where('state').equals('pending').count()
export const failedCount = () => local.queue.where('state').equals('failed').count()
