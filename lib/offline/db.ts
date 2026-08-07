import Dexie, { type EntityTable } from 'dexie'

/** Tables that must accept writes with no network. Reads-only data isn't mirrored. */
export type SyncState = 'pending' | 'synced' | 'failed'

export interface QueuedMutation {
  /** Client-generated uuid. Sent as the row's primary key → replay is idempotent. */
  id: string
  table: 'food_log_entries' | 'workout_sessions' | 'workout_sets' | 'body_measurements'
  op: 'insert' | 'update' | 'delete'
  payload: unknown
  createdAt: number
  retryCount: number
  lastError?: string
  state: SyncState
}

/** Local mirror of a logged row, so the UI renders instantly and offline. */
export interface LocalRow {
  id: string
  table: QueuedMutation['table']
  /** Calendar day for list/grouping queries without parsing payloads. */
  day: string
  data: unknown
  state: SyncState
}

class CoachientaDb extends Dexie {
  queue!: EntityTable<QueuedMutation, 'id'>
  rows!: EntityTable<LocalRow, 'id'>

  constructor() {
    super('coachienta')
    this.version(1).stores({
      queue: 'id, state, createdAt',
      rows: 'id, [table+day], state',
    })
  }
}

export const local = new CoachientaDb()

/**
 * iOS Safari can evict IndexedDB after ~7 idle days. Cloud is the source of
 * truth, but asking for durability costs nothing (PRD-001 §4.1).
 */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
  return navigator.storage.persisted().then((p) => p || navigator.storage.persist())
}
