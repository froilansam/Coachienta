'use client'
import { useLiveQuery } from 'dexie-react-hooks'
import { useOnline } from '@/hooks/useOnline'
import { local } from '@/lib/offline/db'
import { flush } from '@/lib/offline/sync'

/**
 * Live queue state for the header badge. `useLiveQuery` re-runs on any Dexie
 * write, so this needs no polling.
 */
export interface SyncStatus {
  online: boolean
  pending: number
  failed: number
  retry: () => void
}

export function useSyncStatus(): SyncStatus {
  const online = useOnline()

  const pending = useLiveQuery(() => local.queue.where('state').equals('pending').count(), [], 0)
  const failed = useLiveQuery(() => local.queue.where('state').equals('failed').count(), [], 0)

  return { online, pending: pending ?? 0, failed: failed ?? 0, retry: () => void flush() }
}
