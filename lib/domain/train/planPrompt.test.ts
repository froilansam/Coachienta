import { describe, expect, it } from 'vitest'
import type { Exercise } from './exercise'
import type { CriticalRule, PlanItem } from './plan'
import type { History } from './progression'
import {
  buildPlanPrompt,
  catalogue,
  catalogueLine,
  draftNotice,
  enforceCriticalOrder,
  hydrate,
  keepKnownExercises,
  type DraftItem,
} from './planPrompt'

const ex = (over: Partial<Exercise> = {}): Exercise => ({
  id: 'e1',
  name: 'Shoulder Press Machine',
  muscle_group: 'shoulders_front',
  movement_pattern: 'vertical_pull',
  load_type: 'external_weight',
  is_unilateral: false,
  equipment: 'machine',
  aliases: [],
  is_active: true,
  set_count: 0,
  last_performed_on: null,
  ...over,
})

const hist = (over: Partial<History> = {}): History => ({
  last_performed_on: '2026-08-04',
  last_weight_kg: 55,
  last_reps: 10,
  last_duration_sec: null,
  best_weight_kg: 60,
  best_reps: 8,
  best_on: '2026-07-28',
  sessions_since: 2,
  ...over,
})

const item = (over: Partial<DraftItem> = {}): DraftItem => ({
  exercise_id: 'e1',
  position: 1,
  target_sets: 3,
  target_rep_low: 8,
  target_rep_high: 12,
  why: null,
  ...over,
})

describe('catalogueLine', () => {
  it('carries the id first, so the model has one thing to quote', () => {
    const line = catalogueLine(ex(), hist())
    expect(line.startsWith('e1 | Shoulder Press Machine |')).toBe(true)
    expect(line).toContain('last 55kg×10 on 2026-08-04')
    expect(line).toContain('best 60kg')
    expect(line).toContain('2 sessions ago')
  })

  it('says so plainly when there is no history at this gym', () => {
    expect(catalogueLine(ex(), null)).toContain('never logged here')
    expect(catalogueLine(ex(), hist({ last_performed_on: null }))).toContain('never logged here')
  })

  it('a timed exercise reports seconds, never a weight', () => {
    const line = catalogueLine(
      ex({ id: 'p', name: 'Plank', load_type: 'duration' }),
      hist({ last_weight_kg: null, last_reps: null, last_duration_sec: 60, best_weight_kg: null }),
    )
    expect(line).toContain('last 60s')
    expect(line).not.toContain('kg')
  })

  it('bodyweight reps stand in when there is no load', () => {
    const line = catalogueLine(
      ex({ id: 'pu', name: 'Pull-Ups', load_type: 'bodyweight' }),
      hist({ last_weight_kg: null, best_weight_kg: null, last_reps: 9 }),
    )
    expect(line).toContain('last 9 reps')
  })
})

describe('buildPlanPrompt', () => {
  it('puts the coach rules before the instructions and the catalogue last', () => {
    const prompt = buildPlanPrompt({
      coachPrompt: 'FACTS\n- Today is 2026-08-06.\n\nSAFETY — NON-NEGOTIABLE\n- [CRITICAL] No obliques',
      catalogue: catalogue([ex()], { e1: hist() }),
      gymName: 'Anytime Shinjuku',
      today: '2026-08-06',
    })
    // Criticals lead, because a model attends to what comes first (AC-4.8).
    expect(prompt.indexOf('[CRITICAL]')).toBeLessThan(prompt.indexOf('HOW TO BUILD THE PLAN'))
    expect(prompt.indexOf('HOW TO BUILD THE PLAN')).toBeLessThan(prompt.indexOf('EXERCISE CATALOGUE'))
    expect(prompt).toContain('Anytime Shinjuku')
    // It is told not to invent a load — history is attached afterwards, by SQL.
    expect(prompt).toContain('Never suggest a load or a weight')
  })
})

describe('keepKnownExercises', () => {
  const byId = new Map([
    ['e1', ex()],
    ['e2', ex({ id: 'e2', name: 'Lateral Raises', muscle_group: 'shoulders_side' })],
  ])

  it('AC-2.15 — an invented id is dropped and reported', () => {
    const kept = keepKnownExercises(
      [item({ exercise_id: 'e1' }), item({ exercise_id: 'not-in-library', position: 2 })],
      byId,
    )
    expect(kept.items).toHaveLength(1)
    expect(kept.invented).toEqual(['not-in-library'])
  })

  it('renumbers so position has no gaps after a drop', () => {
    const kept = keepKnownExercises(
      [
        item({ exercise_id: 'ghost', position: 1 }),
        item({ exercise_id: 'e1', position: 2 }),
        item({ exercise_id: 'e2', position: 3 }),
      ],
      byId,
    )
    // `position` is what the critical order rule is checked against, so a gap would
    // make the check read the wrong row.
    expect(kept.items.map((i) => i.position)).toEqual([1, 2])
  })

  it('keeps a duplicate once, at its first position', () => {
    const kept = keepKnownExercises(
      [item({ exercise_id: 'e1', position: 1 }), item({ exercise_id: 'e1', position: 2 })],
      byId,
    )
    expect(kept.items).toHaveLength(1)
    expect(kept.duplicates).toEqual(['Shoulder Press Machine'])
  })

  it('sorts by the position the model gave, not the array order', () => {
    const kept = keepKnownExercises(
      [item({ exercise_id: 'e2', position: 2 }), item({ exercise_id: 'e1', position: 1 })],
      byId,
    )
    expect(kept.items.map((i) => i.exercise_id)).toEqual(['e1', 'e2'])
  })
})

describe('hydrate', () => {
  const byId = new Map([['e1', ex()]])

  it('produces the same PlanItem shape a template does', () => {
    const [row] = hydrate([item({ target_sets: 4, why: 'heaviest press first' })], byId)
    expect(row!.exercise.id).toBe('e1')
    expect(row!.target_sets).toBe(4)
    expect(row!.rep_low).toBe(8)
    expect(row!.rep_high).toBe(12)
    expect(row!.progression_rule).toBe('heaviest press first')
  })

  it('corrects a reversed rep range rather than rejecting the row', () => {
    const [row] = hydrate([item({ target_rep_low: 15, target_rep_high: 10 })], byId)
    expect([row!.rep_low, row!.rep_high]).toEqual([10, 15])
  })
})

// ---------------------------------------------------------------------------
const ORDER_RULE: CriticalRule = {
  title: 'Shoulder press before chest',
  content: 'Always do the shoulder press before any chest press.',
  category: 'exercise_order',
}

const plan = (...exercises: Exercise[]): PlanItem[] =>
  exercises.map((exercise) => ({
    exercise,
    target_sets: 3,
    rep_low: 8,
    rep_high: 12,
    progression_rule: null,
  }))

const SHOULDER = ex({ name: 'Shoulder Press Machine' })
const CHEST = ex({ id: 'c1', name: 'Chest Press Machine', muscle_group: 'chest' })
const LATERAL = ex({ id: 'l1', name: 'Lateral Raises', muscle_group: 'shoulders_side' })

describe('enforceCriticalOrder', () => {
  it('AC-2.16 — a chest press above the shoulder press is moved below it', () => {
    const { items, moved, unresolved } = enforceCriticalOrder(
      plan(CHEST, LATERAL, SHOULDER),
      [ORDER_RULE],
    )
    expect(items.map((i) => i.exercise.name)).toEqual([
      'Lateral Raises',
      'Shoulder Press Machine',
      'Chest Press Machine',
    ])
    expect(moved).toEqual(['Chest Press Machine'])
    expect(unresolved).toEqual([])
  })

  it('leaves a compliant plan exactly as it was', () => {
    const before = plan(SHOULDER, CHEST)
    const { items, moved } = enforceCriticalOrder(before, [ORDER_RULE])
    expect(items.map((i) => i.exercise.name)).toEqual(['Shoulder Press Machine', 'Chest Press Machine'])
    expect(moved).toEqual([])
  })

  it('does nothing when the plan has no chest work to conflict', () => {
    const { items, moved } = enforceCriticalOrder(plan(SHOULDER, LATERAL), [ORDER_RULE])
    expect(items).toHaveLength(2)
    expect(moved).toEqual([])
  })

  it('reports a rule it could not satisfy instead of looping', () => {
    // A safety rule about loaded core work cannot be fixed by reordering.
    const safety: CriticalRule = {
      title: 'No heavy obliques',
      content: 'No loaded oblique work. Plank-based core only.',
      category: 'safety',
    }
    const abs = ex({ id: 'a1', name: 'Ab Crunch Machine', muscle_group: 'abs_core' })
    const { unresolved } = enforceCriticalOrder(plan(SHOULDER, abs), [safety])
    expect(unresolved).toEqual(['No heavy obliques'])
  })
})

describe('draftNotice', () => {
  const none = { modelNotice: null, invented: [], duplicates: [], moved: [], unresolved: [] }

  it('says nothing when nothing was compromised', () => {
    expect(draftNotice(none)).toBeNull()
  })

  it('reports a server-side correction rather than hiding it', () => {
    // A draft that was quietly edited by the server is one you cannot reason about.
    const note = draftNotice({ ...none, invented: ['ghost-id'], moved: ['Chest Press Machine'] })
    expect(note).toContain('1 suggested exercise not in your library')
    expect(note).toContain('Reordered to satisfy a critical rule: Chest Press Machine.')
  })

  it("keeps the model's own notice first", () => {
    const note = draftNotice({ ...none, modelNotice: 'No rear-delt isolation in the library.' })
    expect(note!.startsWith('No rear-delt isolation')).toBe(true)
  })

  it('tells the user to reorder when a rule still stands broken', () => {
    expect(draftNotice({ ...none, unresolved: ['No heavy obliques'] })).toContain(
      'reorder before you start',
    )
  })
})
