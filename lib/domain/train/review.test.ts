import { describe, expect, it } from 'vitest'
import type { PriorSet } from './detectPr'
import type { History } from './progression'
import { buildReviewBrief, reviewFingerprint, type ReviewExercise, type ReviewLoggedSet } from './review'

const exercise = (o: Partial<ReviewExercise> & Pick<ReviewExercise, 'position' | 'name'>): ReviewExercise => ({
  exerciseId: o.name,
  muscleGroup: 'chest',
  loadType: 'external_weight',
  ...o,
})

const set = (o: Partial<ReviewLoggedSet> & Pick<ReviewLoggedSet, 'position' | 'setIndex'>): ReviewLoggedSet => ({
  exerciseId: 'bench',
  kind: 'working',
  side: null,
  weightKg: 60,
  reps: 8,
  durationSec: null,
  isPr: false,
  prScope: null,
  ...o,
})

const history = (o: Partial<History> = {}): History => ({
  last_performed_on: '2026-10-13',
  last_weight_kg: 60,
  last_reps: 8,
  last_duration_sec: null,
  best_weight_kg: 60,
  best_reps: 8,
  best_on: '2026-10-13',
  sessions_since: 0,
  ...o,
})

const prior = (o: Partial<PriorSet> = {}): PriorSet => ({
  performed_on: '2026-10-13',
  set_ordinal: 1,
  side: null,
  weight_kg: 60,
  reps: 8,
  duration_sec: null,
  ...o,
})

describe('reviewFingerprint', () => {
  it('ignores the order the rows arrive in', () => {
    const a = set({ position: 1, setIndex: 1 })
    const b = set({ position: 1, setIndex: 2, weightKg: 55, reps: 8 })
    expect(reviewFingerprint([a, b])).toBe(reviewFingerprint([b, a]))
  })

  it('changes when a load changes, so an edited session is read again', () => {
    const base = [set({ position: 1, setIndex: 1 })]
    expect(reviewFingerprint(base)).not.toBe(reviewFingerprint([set({ position: 1, setIndex: 1, weightKg: 62.5 })]))
  })
})

describe('buildReviewBrief', () => {
  const exercises = [
    exercise({ position: 1, exerciseId: 'press', name: 'Shoulder Press Machine' }),
    exercise({ position: 2, exerciseId: 'fly', name: 'Cable Fly' }),
    exercise({ position: 3, exerciseId: 'bench', name: 'Bench Press' }),
  ]

  it('says the third exercise was done after the first two', () => {
    const brief = buildReviewBrief({
      name: 'Push',
      performedOn: '2026-10-18',
      gymName: 'Current gym',
      exercises,
      sets: [set({ position: 3, exerciseId: 'bench', setIndex: 1, weightKg: 70, reps: 6, isPr: true, prScope: 'all_time' })],
      history: { bench: history({ best_weight_kg: 65, best_reps: 6, best_on: '2026-10-01' }) },
      priorSets: {
        bench: [
          prior({ performed_on: '2026-10-01', weight_kg: 65, reps: 6 }),
          prior({ performed_on: '2026-10-13', set_ordinal: 1, weight_kg: 60, reps: 8 }),
          prior({ performed_on: '2026-10-13', set_ordinal: 2, weight_kg: 60, reps: 7 }),
        ],
      },
    })

    expect(brief).toContain('1. Shoulder Press Machine')
    expect(brief).toContain('first — done fresh')
    expect(brief).toContain('3. Bench Press')
    expect(brief).toContain('exercise 3 of 3, after Shoulder Press Machine, Cable Fly')
    expect(brief).toContain('70 kg × 6')
    expect(brief).toContain('PR all_time')
    // Only the latest previous day, not the older 65 kg session.
    expect(brief).toContain('previous 2026-10-13: set 1 60 kg × 8; set 2 60 kg × 7')
    expect(brief).not.toContain('previous 2026-10-01')
    expect(brief).toContain('best weight: 65 kg × 6 on 2026-10-01')
  })

  it('says an exercise with no sets was not logged', () => {
    const brief = buildReviewBrief({
      name: 'Push',
      performedOn: '2026-10-18',
      gymName: 'Current gym',
      exercises: [exercise({ position: 1, name: 'Plank', loadType: 'duration', muscleGroup: 'core' })],
      sets: [],
      history: {},
      priorSets: {},
    })
    expect(brief).toContain('today: not logged')
    expect(brief).toContain('previous: none at this gym')
  })
})
