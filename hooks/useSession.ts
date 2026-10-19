'use client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SessionPayload } from '@/app/api/data/session/route'
import { local } from '@/lib/offline/db'
import { SYNCED_EVENT, enqueue, flush } from '@/lib/offline/sync'
import {
  blankSet,
  formatDuration,
  inputsFor,
  isComplete,
  isWorkingSet,
  prevAtPosition,
  recordAtPosition,
  setLabel,
  setOrdinal,
  totals,
  type SetInputs,
  type SetRow,
  type Totals,
} from '@/lib/domain/train/session'
import {
  detectPr,
  type PrKind,
  type PriorSet,
  type PrScope,
  type PrVerdict,
} from '@/lib/domain/train/detectPr'
import { suggestTarget, type Target } from '@/lib/domain/train/progression'
import { reviewFingerprint, type ReviewLoggedSet, type SessionReview } from '@/lib/domain/train/review'
import type { ExerciseLite } from '@/lib/db/queries/plan'
import type { ExerciseListResponse } from '@/app/api/data/exercises/route'
import type { Exercise } from '@/lib/domain/train/exercise'

/**
 * The live session. Local-first, because this screen is used in a basement.
 *
 * A commit writes to IndexedDB and returns; the row re-renders from Dexie through
 * `useLiveQuery`, so the lock is visible without a single network await (AC-2.1:
 * under 200 ms in airplane mode). Upload happens later on the same queue that
 * Feature 1's food logging already proved, including the client-generated-uuid
 * idempotency that stops a replayed flush duplicating anything (AC-2.9).
 */
export interface ExerciseBlock {
  position: number
  exercise: ExerciseLite
  inputs: SetInputs
  rows: SetRow[]
  /** Per-row `PREV`, aligned by index. Always populated (US-2.4). */
  prev: string[]
  /** Per-row standing record at that position, aligned by index. `null` before one exists. */
  record: Array<string | null>
  target: Target
  targetSets: number | null
  repLow: number | null
  repHigh: number | null
  restSec: number
}

export interface SessionState {
  isLoading: boolean
  loadError: boolean
  notFound: boolean
  retry: () => void

  name: string
  performedOn: string
  gymName: string
  isFinished: boolean

  blocks: ExerciseBlock[]
  totals: Totals
  elapsed: string

  /** Draft edits before commit, keyed by set id. */
  setValue: (row: SetRow, field: 'weight_kg' | 'reps' | 'duration_sec', v: number | null) => void
  toggleWarmup: (row: SetRow) => void
  commit: (row: SetRow) => Promise<void>
  /**
   * Unlocks a saved set so its numbers can be changed (Hevy checkbox toggle).
   * Queues a delete and keeps the values as a draft under the same id.
   */
  uncommit: (row: SetRow) => Promise<void>
  addSet: (position: number, side?: 'left' | 'right' | null) => void
  removeDraft: (id: string) => void
  setRest: (position: number, sec: number) => void

  /** Rest timer, running for whichever exercise last committed a set. */
  rest: { remaining: number; position: number } | null
  adjustRest: (delta: number) => void
  skipRest: () => void

  /** Rows that just committed, so the flash plays once (NumericTable). */
  flashKeys: Set<string>
  /**
   * PR verdicts by set id, decided locally at commit. Keyed so the stamp appears on
   * the row that earned it and nowhere else.
   */
  prs: Record<string, PrVerdict>
  finish: () => Promise<void>
  isFinishing: boolean
  /**
   * The coach's read of a finished session. Hidden until it is finished. A stored
   * read is shown at once; a session that has never been read is read on open.
   */
  review: SessionReview | null
  reviewStatus: 'hidden' | 'empty' | 'loading' | 'ready' | 'error'
  reviewError: string | null
  retryReview: () => void
  label: (row: SetRow) => string

  /**
   * Mid-session exercise editing (US-2.18, AC-2.23). The machine you planned for was
   * occupied, so the plan changes — §6 calls this first-class, not an edge case.
   */
  library: Exercise[]
  pickerOpen: boolean
  openPicker: () => void
  closePicker: () => void
  addExercise: (exerciseId: string) => Promise<void>
  /** The block awaiting a delete confirmation, and the sentence shown about it. */
  pendingRemoval: ExerciseBlock | null
  removalText: string
  askRemove: (block: ExerciseBlock) => void
  cancelRemove: () => void
  confirmRemove: () => Promise<void>
  isEditing: boolean
  editError: string | null
}

const MIRROR_TABLE = 'workout_sets' as const

/**
 * This session's saved working sets, shaped like `prior_sets` rows. Numbered over the
 * WHOLE block, drafts included, so a set saved out of order holds the same position
 * here as the candidate being judged against it.
 */
function savedToday(block: readonly SetRow[], performedOn: string): PriorSet[] {
  return block
    .filter((r) => r.committed && isWorkingSet(r))
    .map((r) => ({
      performed_on: performedOn,
      set_ordinal: setOrdinal(r, block),
      side: r.side,
      weight_kg: r.weight_kg,
      reps: r.reps,
      duration_sec: r.duration_sec,
    }))
}

export function useSession(sessionId: string): SessionState {
  const qc = useQueryClient()
  const [drafts, setDrafts] = useState<Record<string, SetRow>>({})
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState<ExerciseBlock | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  /**
   * Rest is stored as a DEADLINE, not a countdown.
   *
   * A ticking `setRest(r => r - 1)` inside an effect is a cascading render, and it
   * drifts whenever the tab is backgrounded — which is most of a rest period on a
   * phone. One clock, one subtraction at render.
   */
  const [restUntil, setRestUntil] = useState<{ at: number; position: number } | null>(null)
  const [restBy, setRestBy] = useState<Record<number, number>>({})
  const [flashKeys, setFlashKeys] = useState<Set<string>>(new Set())
  /**
   * Verdicts decided on THIS visit. They carry the prose evidence; the ones read back
   * from the server carry only the verdict, since `basis` is derived and not stored.
   */
  const [localPrs, setLocalPrs] = useState<Record<string, PrVerdict>>({})
  /**
   * Ids that have already started a rest timer this visit. Re-saving after an
   * uncheck must not restart rest — you are correcting numbers, not finishing a set.
   */
  const [restedIds, setRestedIds] = useState<Set<string>>(() => new Set())
  const [isFinishing, setIsFinishing] = useState(false)
  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())

  const { data, isLoading, error, refetch } = useQuery<SessionPayload>({
    queryKey: ['session', sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/data/session?id=${sessionId}`)
      if (res.status === 404) throw new Error('NOT_FOUND')
      if (!res.ok) throw new Error('session')
      return res.json() as Promise<SessionPayload>
    },
  })

  /**
   * Sets queued locally but not yet uploaded. Merged with the server's, so a set
   * committed offline is on screen immediately and stays there across a reload.
   */
  const pending = useLiveQuery(
    () => local.rows.where('[table+day]').equals([MIRROR_TABLE, sessionId]).toArray(),
    [sessionId],
    [],
  )

  /**
   * Deletes still in the queue. Without this, uncheck → refetch would bring the
   * row back as locked while the delete is still uploading (same race as food).
   */
  const pendingDeleteIds = useLiveQuery(
    async () => {
      const queued = await local.queue.where('state').notEqual('synced').toArray()
      return new Set(
        queued.filter((m) => m.table === MIRROR_TABLE && m.op === 'delete').map((m) => m.id),
      )
    },
    [],
    new Set<string>(),
  )

  // One ticking clock for the session duration and the rest countdown.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  /** Refetch once a set write lands, so the server view matches the mirror. */
  useEffect(() => {
    const onSynced = (e: Event) => {
      const table = (e as CustomEvent<{ table?: string }>).detail?.table
      if (table !== undefined && table !== MIRROR_TABLE) return
      void qc.invalidateQueries({ queryKey: ['session', sessionId] })
    }
    window.addEventListener(SYNCED_EVENT, onSynced)
    return () => window.removeEventListener(SYNCED_EVENT, onSynced)
  }, [qc, sessionId])

  const mirrored = useMemo<SetRow[]>(() => {
    return (pending ?? []).map((r) => {
      const data = r.data as SetRow
      return {
        ...data,
        id: r.id,
        derived: false,
        // Unchecked drafts persist in the mirror with `committed: false` so a
        // reload does not erase a set the user is mid-correcting.
        committed: data.committed !== false,
      }
    })
  }, [pending])

  const committed = useMemo<SetRow[]>(() => {
    const server = (data?.sets ?? [])
      .filter((s) => !pendingDeleteIds?.has(s.id))
      .map((s) => ({
        id: s.id,
        exercise_id: s.exercise_id,
        position: s.position,
        set_index: s.set_index,
        kind: s.kind as SetRow['kind'],
        weight_kg: s.weight_kg,
        reps: s.reps,
        duration_sec: s.duration_sec,
        side: (s.side as SetRow['side']) ?? null,
        committed: true,
        derived: false,
      }))
    // Local wins on id collision: it is the newer write by definition.
    const byId = new Map(server.map((s) => [s.id, s]))
    for (const l of mirrored.filter((r) => r.committed)) byId.set(l.id, l)
    return [...byId.values()]
  }, [data?.sets, mirrored, pendingDeleteIds])

  /**
   * Unlocked rows from the mirror, overlaid by in-memory draft edits.
   * In-memory wins so keystrokes do not wait on IndexedDB.
   */
  const draftsMerged = useMemo<Record<string, SetRow>>(() => {
    const out: Record<string, SetRow> = {}
    for (const r of mirrored.filter((row) => !row.committed)) out[r.id] = r
    for (const [id, row] of Object.entries(drafts)) out[id] = row
    return out
  }, [mirrored, drafts])

  /** Memoised: a fresh `[]` / `{}` each render defeats every memo below. */
  const items = useMemo(() => data?.session.items ?? [], [data])
  const history = useMemo(() => data?.history ?? {}, [data])
  const priorSets = useMemo(() => data?.priorSets ?? {}, [data])
  const performedOn = data?.session.performed_on ?? ''

  const loadTypeOf = useCallback(
    (exerciseId: string) =>
      items.find((i) => i.exercise_id === exerciseId)?.exercise?.load_type ?? 'external_weight',
    [items],
  )

  const blocks = useMemo<ExerciseBlock[]>(() => {
    return items.map((item, i) => {
      const position = i + 1
      const exercise = item.exercise ?? {
        id: item.exercise_id,
        name: item.name,
        muscle_group: 'other',
        movement_pattern: 'other',
        load_type: 'external_weight',
        is_unilateral: false,
        equipment: null,
      }
      const real = [
        ...committed.filter((r) => r.position === position),
        ...Object.values(draftsMerged).filter((d) => d.position === position),
      ]
      /**
       * An exercise with nothing on it yet gets one derived blank row, with a
       * deterministic id. Seeding it into state from an effect was a cascading
       * render; deriving it is free and it becomes real state on the first keystroke.
       */
      const h = history[item.exercise_id] ?? null
      const target = suggestTarget(h, item.target_rep_low, item.target_rep_high, exercise.load_type)
      const blank = blankSet(item.exercise_id, position, [], null, `draft:${position}`)
      /**
       * Set 1 starts at the working weight. A derived row is not saved until it is
       * edited, so this is a suggestion sitting in the field, not a logged set.
       */
      const seeded =
        blank.weight_kg === null && target.loadKg !== null ? { ...blank, weight_kg: target.loadKg } : blank
      const mine = (real.length > 0 ? real : [seeded]).sort(
        (a, b) => a.set_index - b.set_index || (a.side ?? '').localeCompare(b.side ?? ''),
      )

      const priors = priorSets[item.exercise_id] ?? []
      return {
        position,
        exercise,
        inputs: inputsFor(exercise.load_type),
        rows: mine,
        /**
         * Per POSITION, not per exercise: set 3 shows your last set 3. Pointing every
         * row at the exercise's top set gave sets 2 and 3 a target they were never
         * meant to hit, which is the same reason their progress never counted.
         */
        prev: mine.map((r) =>
          prevAtPosition(priors, exercise.load_type, setOrdinal(r, mine), r.side),
        ),
        /**
         * Today's saved sets join the record, so beating it moves it on the spot —
         * and only then. `PREV` deliberately does not: it is the last session.
         */
        record: mine.map((r) =>
          recordAtPosition(
            [...priors, ...savedToday(mine, performedOn)],
            exercise.load_type,
            setOrdinal(r, mine),
            r.side,
          ),
        ),
        target,
        targetSets: item.target_sets,
        repLow: item.target_rep_low,
        repHigh: item.target_rep_high,
        restSec: restBy[position] ?? 90,
      }
    })
  }, [items, committed, draftsMerged, history, priorSets, performedOn, restBy])

  /**
   * Takes the ROW, not an id. A derived blank row is not in `drafts` yet, and the
   * caller already has it — looking it up again would mean the hook keeping a
   * shadow index of rows it deliberately does not store.
   */
  const setValue = useCallback(
    (row: SetRow, field: 'weight_kg' | 'reps' | 'duration_sec', v: number | null) => {
      setDrafts((prev) => ({ ...prev, [row.id]: { ...(prev[row.id] ?? row), [field]: v } }))
    },
    [],
  )

  const commit = useCallback(
    async (row: SetRow) => {
      if (row.committed) return
      const loadType = loadTypeOf(row.exercise_id)
      if (!isComplete(row, loadType)) return

      /**
       * A derived row's id is a React key, not a database key. `workout_sets.id` is
       * a uuid and the sync route validates it, so a readable placeholder has to be
       * replaced here. Minted once and stored in the queue, so a replayed flush
       * still upserts on the same id (AC-2.9).
       */
      const persistedId = row.derived ? crypto.randomUUID() : row.id
      const isResave = restedIds.has(persistedId)

      /**
       * The POSITION this set holds — its rank among the exercise's working sets,
       * warmups skipped. Computed over every row of the block, committed or draft, so
       * it matches what `prior_sets` will number this row as once it uploads.
       */
      const block = new Map<string, SetRow>()
      for (const r of committed) if (r.exercise_id === row.exercise_id) block.set(r.id, r)
      for (const d of Object.values(draftsMerged)) {
        if (d.exercise_id === row.exercise_id) block.set(d.id, d)
      }
      block.set(row.id, row)
      const ordinal = setOrdinal(row, [...block.values()])

      /**
       * PR decided here, on the client, before the write. §4.3 requires the stamp
       * with no round trip.
       *
       * This session's already-committed sets join the pool so an all-time claim has
       * to clear today as well. They cannot pollute the positional comparison — every
       * one of them holds a different position by construction. The pool is the same
       * one `record` is replayed from, so the stamp and the record line cannot disagree.
       */
      const priors = [
        ...(priorSets[row.exercise_id] ?? []),
        ...savedToday([...block.values()], data?.session.performed_on ?? ''),
      ]
      // A warmup is never a PR — beating a warmup is not a record.
      const verdict: PrVerdict =
        row.kind === 'warmup'
          ? { isPr: false, kinds: [], scope: null, setOrdinal: 0, previousBest: null, basis: null }
          : detectPr({ ...row, set_ordinal: ordinal }, priors, loadType)

      /**
       * Local write, then return. Nothing here awaits the network — that is the
       * whole of AC-2.1. `enqueue` puts the mutation and the mirror row in one
       * Dexie transaction and kicks a flush that we deliberately do not wait for.
       */
      await enqueue(
        {
          id: persistedId,
          table: MIRROR_TABLE,
          op: 'insert',
          payload: {
            session_id: sessionId,
            exercise_id: row.exercise_id,
            position: row.position,
            set_index: row.set_index,
            kind: row.kind,
            weight_kg: row.weight_kg,
            reps: row.reps,
            duration_sec: row.duration_sec,
            side: row.side,
            is_pr: verdict.isPr,
            // `first_time` is recorded but is not a PR — the distinction is the
            // whole reason PRs mean anything here (§3.3).
            pr_kinds: verdict.kinds,
            // `set` (best this position has done) or `all_time` (best of any set).
            pr_scope: verdict.scope,
          },
        },
        // `day` is the session id, so a reload reads back exactly this session's
        // queued sets rather than every set ever logged offline.
        { day: sessionId, data: { ...row, id: persistedId, committed: true, derived: false } },
      )

      setDrafts((prev) => {
        const next = { ...prev }
        delete next[row.id]
        /**
         * Re-saving after an uncheck must not pile on another blank row — the next
         * set was already offered on the first commit.
         */
        const hasOpen = Object.values(next).some(
          (d) => d.position === row.position && d.side === row.side && !d.committed,
        )
        if (!hasOpen) {
          const sibling = blankSet(
            row.exercise_id,
            row.position,
            [...committed.filter((r) => r.position === row.position), { ...row, id: persistedId }],
            row.side,
          )
          next[sibling.id] = sibling
        }
        return next
      })

      setFlashKeys((prev) => new Set(prev).add(persistedId))
      if (verdict.kinds.length > 0) setLocalPrs((prev) => ({ ...prev, [persistedId]: verdict }))
      else {
        setLocalPrs((prev) => {
          const next = { ...prev }
          delete next[persistedId]
          return next
        })
      }
      setRestedIds((prev) => new Set(prev).add(persistedId))
      if (!isResave) {
        const seconds = restBy[row.position] ?? 90
        if (seconds > 0) setRestUntil({ at: Date.now() + seconds * 1000, position: row.position })
      }
    },
    [
      loadTypeOf,
      sessionId,
      committed,
      draftsMerged,
      restBy,
      priorSets,
      data?.session.performed_on,
      restedIds,
    ],
  )

  const uncommit = useCallback(
    async (row: SetRow) => {
      if (!row.committed || row.derived) return

      /**
       * Presence in `workout_sets` is the commit bit — there is no soft flag. Uncheck
       * deletes the row (same queue as food deletes) and keeps the numbers as a draft
       * under the same id so a re-tick upserts instead of duplicating.
       */
      const unlocked: SetRow = { ...row, committed: false, derived: false }
      await enqueue({ id: row.id, table: MIRROR_TABLE, op: 'delete', payload: {} })
      await local.rows.put({
        id: row.id,
        table: MIRROR_TABLE,
        day: sessionId,
        data: unlocked,
        state: 'pending',
      })

      setDrafts((prev) => ({ ...prev, [row.id]: unlocked }))
      setLocalPrs((prev) => {
        const next = { ...prev }
        delete next[row.id]
        return next
      })
      setFlashKeys((prev) => {
        const next = new Set(prev)
        next.delete(row.id)
        return next
      })
    },
    [sessionId],
  )

  /**
   * The exercise library, for the mid-session picker. Its own query rather than an
   * addition to the session payload: it is needed only when the sheet opens, and the
   * session read is on the critical path of a screen used between sets.
   */
  const { data: libraryData } = useQuery<ExerciseListResponse>({
    queryKey: ['exercises'],
    queryFn: async () => {
      const res = await fetch('/api/data/exercises')
      if (!res.ok) throw new Error('exercises')
      return res.json()
    },
    enabled: pickerOpen,
  })

  /**
   * Both edits go to the server and wait, unlike everything else on this screen.
   *
   * `plan_exercises` has no Dexie mirror, so an exercise added offline would show a
   * block whose SETS survive a reload and whose heading does not. Sets stay
   * local-first — that is the part that has to work in a basement — and this asks for
   * a connection and says so when it does not have one.
   */
  const edit = useCallback(
    async (body: Record<string, unknown>) => {
      setIsEditing(true)
      setEditError(null)
      try {
        const res = await fetch('/api/data/session', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, session_id: sessionId }),
        })
        if (!res.ok) throw new Error('Could not change the session.')
        await refetch()
        return true
      } catch {
        setEditError('That needs a connection. Your logged sets are safe on this device.')
        return false
      } finally {
        setIsEditing(false)
      }
    },
    [sessionId, refetch],
  )

  const addExercise = useCallback(
    async (exerciseId: string) => {
      // Three sets, no rep range: an exercise you did not plan has no plan to inherit,
      // and inventing a range would put an unearned target on the screen.
      const ok = await edit({ op: 'add_exercise', exercise_id: exerciseId, target_sets: 3 })
      if (ok) setPickerOpen(false)
    },
    [edit],
  )

  const confirmRemove = useCallback(async () => {
    const block = pendingRemoval
    if (block === null) return
    const ok = await edit({ op: 'remove_exercise', position: block.position })
    if (!ok) return

    /**
     * Local state has to follow the server, in three places: the queued mirror rows
     * for this position, any uncommitted drafts, and the rest timer if it belonged to
     * the exercise that just left. Positions below shift up by one at the database, so
     * stale local rows would render against the wrong exercise.
     */
    const ids = (pending ?? [])
      .filter((r) => (r.data as SetRow).position === block.position)
      .map((r) => r.id)
    if (ids.length > 0) await local.rows.bulkDelete(ids)
    setDrafts({})
    setRestUntil((r) => (r?.position === block.position ? null : r))
    setPendingRemoval(null)
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['sessions'] }),
      qc.invalidateQueries({ queryKey: ['trends'] }),
    ])
  }, [pendingRemoval, edit, pending, qc])

  const loggedForReview = useMemo<ReviewLoggedSet[]>(
    () =>
      (data?.sets ?? []).map((s) => ({
        position: s.position,
        exerciseId: s.exercise_id,
        setIndex: s.set_index,
        kind: s.kind,
        side: s.side,
        weightKg: s.weight_kg,
        reps: s.reps,
        durationSec: s.duration_sec,
        isPr: s.is_pr,
        prScope: s.pr_scope,
      })),
    [data?.sets],
  )
  const fingerprint = useMemo(() => reviewFingerprint(loggedForReview), [loggedForReview])
  const storedReview =
    data?.session.review && data.session.reviewFingerprint === fingerprint && fingerprint !== ''
      ? data.session.review
      : null
  const [reviewNonce, setReviewNonce] = useState(0)
  const [fetchedReview, setFetchedReview] = useState<{
    token: string
    review: SessionReview | null
    error: string | null
  } | null>(null)
  const reviewToken = `${reviewNonce}:${fingerprint}`
  const fetched = fetchedReview?.token === reviewToken ? fetchedReview : null
  const finished = data?.session.completed_at != null
  /** One attempt to upload sets that finished before they reached the server. */
  const flushedEmpty = useRef<string | null>(null)

  useEffect(() => {
    if (!finished || fingerprint !== '' || committed.length === 0) return
    if (flushedEmpty.current === sessionId) return
    flushedEmpty.current = sessionId
    void flush().then(() => refetch())
  }, [finished, fingerprint, committed.length, sessionId, refetch])

  useEffect(() => {
    if (!finished || fingerprint === '' || storedReview) return
    if (fetchedReview?.token === reviewToken) return
    let cancel = false
    void (async () => {
      await flush()
      const res = await fetch('/api/data/session-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId }),
      })
      const body = (await res.json().catch(() => null)) as {
        review?: SessionReview
        error?: string
      } | null
      if (cancel) return
      setFetchedReview({
        token: reviewToken,
        review: body?.review ?? null,
        error: body?.review ? null : (body?.error ?? 'The coach could not read this session.'),
      })
      if (body?.review) await refetch()
    })()
    return () => {
      cancel = true
    }
  }, [finished, fingerprint, storedReview, fetchedReview?.token, reviewToken, sessionId, refetch])

  const review = storedReview ?? fetched?.review ?? null
  const reviewStatus: SessionState['reviewStatus'] = !finished
    ? 'hidden'
    : review
      ? 'ready'
      : fingerprint === '' && committed.length === 0
        ? 'empty'
        : fetched?.error
          ? 'error'
          : 'loading'

  const finish = useCallback(async () => {
    setIsFinishing(true)
    try {
      await fetch('/api/data/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId }),
      })
      // Sets have to be on the server before the coach can read them.
      await flush()
      await refetch()
    } finally {
      setIsFinishing(false)
    }
  }, [sessionId, refetch])

  /**
   * Stamps survive a reload. The verdict is stored on the row (`is_pr`, `pr_kinds`,
   * `pr_scope`), so reopening a session shows the records it earned instead of a
   * blank column — the stamp used to live only in this hook's state and vanished the
   * moment you left the screen.
   *
   * `basis` is deliberately absent on these: the sentence is derived, and a stored
   * one goes stale the way the spreadsheet's targets did. This visit's own verdicts
   * are layered on top and do carry it.
   */
  const prs = useMemo<Record<string, PrVerdict>>(() => {
    const stored = new Map((data?.sets ?? []).map((s) => [s.id, s] as const))
    const out: Record<string, PrVerdict> = {}
    for (const row of committed) {
      const s = stored.get(row.id)
      if (s === undefined || !s.is_pr) continue
      const siblings = committed.filter(
        (r) => r.exercise_id === row.exercise_id && isWorkingSet(r),
      )
      out[row.id] = {
        isPr: true,
        kinds: s.pr_kinds as PrKind[],
        // Rows written before per-position PRs were judged against the undivided
        // pool, which is exactly the all-time comparison.
        scope: (s.pr_scope as PrScope | null) ?? 'all_time',
        setOrdinal: setOrdinal(row, siblings),
        previousBest: null,
        basis: null,
      }
    }
    return { ...out, ...localPrs }
  }, [data?.sets, committed, localPrs])

  // Derived, so the countdown survives a backgrounded tab and costs no renders of
  // its own beyond the one-second clock every session already ticks.
  const remaining = restUntil === null ? 0 : Math.max(Math.ceil((restUntil.at - now) / 1000), 0)
  const rest = restUntil !== null && remaining > 0 ? { remaining, position: restUntil.position } : null

  return {
    isLoading,
    loadError: error !== null && error.message !== 'NOT_FOUND',
    notFound: error?.message === 'NOT_FOUND',
    retry: () => void refetch(),

    name: data?.session.name ?? '',
    performedOn,
    gymName: data?.session.gym_name ?? '—',
    isFinished: data?.session.completed_at !== null && data?.session.completed_at !== undefined,

    blocks,
    totals: totals(committed, loadTypeOf),
    /**
     * A finished session reports the time it actually took, from the stored stamps.
     * The live clock counts from when the SCREEN mounted, so reopening a session from
     * last week showed `DURATION 0:01` — a number that was never true of anything.
     * `started_at` is null on imported sessions, so those fall back to a dash.
     */
    elapsed:
      data?.session.completed_at && data.session.started_at
        ? formatDuration(
            new Date(data.session.completed_at).getTime() -
              new Date(data.session.started_at).getTime(),
          )
        : data?.session.completed_at
          ? '—'
          : formatDuration(now - startedAt),

    setValue,
    toggleWarmup: (row) =>
      setDrafts((prev) => {
        const base = prev[row.id] ?? row
        return { ...prev, [row.id]: { ...base, kind: base.kind === 'warmup' ? 'working' : 'warmup' } }
      }),
    commit,
    uncommit,
    addSet: (position, side = null) =>
      setDrafts((prev) => {
        const item = items[position - 1]
        if (!item) return prev
        const existing = [
          ...committed.filter((r) => r.position === position),
          ...Object.values(draftsMerged).filter((d) => d.position === position),
          ...Object.values(prev).filter((d) => d.position === position),
        ]
        // Deduplicate by id — draftsMerged and prev can both hold the same row.
        const byId = new Map(existing.map((r) => [r.id, r]))
        const row = blankSet(item.exercise_id, position, [...byId.values()], side)
        return { ...prev, [row.id]: row }
      }),
    removeDraft: (id) =>
      setDrafts((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      }),
    setRest: (position, sec) => setRestBy((prev) => ({ ...prev, [position]: sec })),

    rest,
    adjustRest: (delta) =>
      setRestUntil((r) => (r ? { ...r, at: Math.max(r.at + delta * 1000, Date.now()) } : r)),
    skipRest: () => setRestUntil(null),

    flashKeys,
    prs,
    finish,
    isFinishing,
    review,
    reviewStatus,
    reviewError: fetched?.error ?? null,
    retryReview: () => {
      flushedEmpty.current = null
      setFetchedReview(null)
      setReviewNonce((n) => n + 1)
    },
    label: setLabel,

    library: libraryData?.exercises ?? [],
    pickerOpen,
    openPicker: () => setPickerOpen(true),
    closePicker: () => setPickerOpen(false),
    addExercise,
    pendingRemoval,
    removalText: pendingRemoval === null ? '' : removalCopy(pendingRemoval),
    askRemove: setPendingRemoval,
    cancelRemove: () => setPendingRemoval(null),
    confirmRemove,
    isEditing,
    editError,
  }
}

/**
 * `Remove Leg Press? 3 saved sets will be deleted. This cannot be undone.`
 *
 * States the committed count, because that is what actually disappears — an
 * untouched block costs nothing to remove and should not be dressed up as dangerous.
 */
function removalCopy(block: ExerciseBlock): string {
  const done = block.rows.filter((r) => r.committed).length
  return done === 0
    ? `Remove ${block.exercise.name} from this session? Nothing has been logged on it.`
    : `Remove ${block.exercise.name}? ${done} saved set${done === 1 ? '' : 's'} will be deleted. This cannot be undone.`
}
