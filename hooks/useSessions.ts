'use client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SessionsPayload } from '@/app/api/data/sessions/route'
import { todayLocal } from '@/lib/domain/date'
import { deleteCopy, groupByDate, type DateGroup, type SessionRow } from '@/lib/domain/train/history'
import { local } from '@/lib/offline/db'
import { enqueue, SYNCED_EVENT } from '@/lib/offline/sync'

/**
 * Session history: grouped by date, and deletable (AC-2.21, AC-2.22).
 *
 * Delete goes through the offline queue, exactly like a food delete — the row leaves
 * the list at once and the mutation uploads when there is signal. `workout_sets`
 * cascade at the database, so one delete is the whole operation and every derived
 * figure (LAST, BEST, PR, volume) recomputes from what remains. Nothing on this
 * screen is a stored snapshot.
 */
export interface SessionsView {
  isLoading: boolean
  loadError: boolean
  retry: () => void

  groups: DateGroup[]
  isEmpty: boolean

  /** The row awaiting confirmation, and the sentence shown about it. */
  pendingDelete: SessionRow | null
  confirmText: string
  askDelete: (row: SessionRow) => void
  cancelDelete: () => void
  confirmDelete: () => Promise<void>
  isDeleting: boolean
}

export function useSessions(): SessionsView {
  const qc = useQueryClient()
  const [pendingDelete, setPending] = useState<SessionRow | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  /**
   * Deletes still sitting in the queue.
   *
   * Read from IndexedDB rather than held in component state, for the reason
   * `useToday` records: the refetch that follows a delete happens before the queue
   * flushes, so the server returns the row again and it reappears. Reading the queue
   * also means the row stays gone across a reload with no signal.
   */
  const pendingDeleteIds = useLiveQuery(
    async () => {
      const queued = await local.queue.where('state').notEqual('synced').toArray()
      return new Set(queued.filter((m) => m.op === 'delete').map((m) => m.id))
    },
    [],
    new Set<string>(),
  )

  const q = useQuery<SessionsPayload>({
    queryKey: ['sessions'],
    queryFn: async () => {
      const res = await fetch('/api/data/sessions')
      if (!res.ok) throw new Error(`sessions: ${res.status}`)
      return res.json()
    },
  })

  const sessions = useMemo(
    () => (q.data?.sessions ?? []).filter((s) => !pendingDeleteIds?.has(s.id)),
    [q.data, pendingDeleteIds],
  )
  const groups = useMemo(() => groupByDate(sessions, todayLocal()), [sessions])

  const confirmDelete = useCallback(async () => {
    if (pendingDelete === null) return
    setIsDeleting(true)
    try {
      // Local-first: no payload needed, the id is the row.
      await enqueue({ id: pendingDelete.id, table: 'workout_sessions', op: 'delete', payload: {} })
      // Its sets go with it at the database (`on delete cascade`), so the local
      // mirror of those sets has to go too or they would linger as pending rows.
      await local.rows.where('[table+day]').equals(['workout_sets', pendingDelete.id]).delete()
      setPending(null)
      // Volume, PRs and LAST/BEST all read from the sets that just went.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['sessions'] }),
        qc.invalidateQueries({ queryKey: ['trends'] }),
        qc.invalidateQueries({ queryKey: ['plan'] }),
      ])
    } finally {
      setIsDeleting(false)
    }
  }, [pendingDelete, qc])

  /** Refetch once the delete actually lands, closing the delete/refetch race. */
  useEffect(() => {
    const onSynced = () => void qc.invalidateQueries({ queryKey: ['sessions'] })
    window.addEventListener(SYNCED_EVENT, onSynced)
    return () => window.removeEventListener(SYNCED_EVENT, onSynced)
  }, [qc])

  return {
    isLoading: q.isPending,
    loadError: q.isError,
    retry: () => void q.refetch(),

    groups,
    isEmpty: sessions.length === 0,

    pendingDelete,
    confirmText: pendingDelete === null ? '' : deleteCopy(pendingDelete),
    askDelete: setPending,
    cancelDelete: () => setPending(null),
    confirmDelete,
    isDeleting,
  }
}
