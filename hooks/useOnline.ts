'use client'
import { useSyncExternalStore } from 'react'

/**
 * Whether the browser thinks it has a connection.
 *
 * `navigator.onLine` is a value the server cannot know, so it is read through
 * useSyncExternalStore: the server snapshot is `true` — assume online, so no
 * offline banner flashes during hydration — and the real value lands in the same
 * commit instead of a second one.
 *
 * Note the browser only reports link state, not reachability. Sync failures are
 * the authority on whether the network actually works (`useSyncStatus`).
 */
function subscribe(cb: () => void): () => void {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}
