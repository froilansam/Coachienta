import { describe, expect, it } from 'vitest'
import { add, canStart, checkRules, itemFor, move, patch, remove, summarise, type CriticalRule, type PlanItem } from './plan'
import type { Exercise } from './exercise'

const ex = (name: string, o: Partial<Exercise> = {}): Exercise => ({
  id: name, name, aliases: [], muscle_group: 'chest', movement_pattern: 'horizontal_push',
  load_type: 'external_weight', is_unilateral: false, equipment: null, is_active: true,
  set_count: 0, last_performed_on: null, ...o,
})

const shoulderPress = ex('Shoulder Press Machine', { muscle_group: 'shoulders_front', movement_pattern: 'vertical_push' })
const chestPress = ex('Chest Press Machine', { muscle_group: 'chest', movement_pattern: 'horizontal_push' })
const item = (e: Exercise): PlanItem => itemFor(e)

describe('itemFor', () => {
  it('defaults a weighted exercise to 3 × 8–12', () => {
    expect(itemFor(chestPress)).toMatchObject({ target_sets: 3, rep_low: 8, rep_high: 12 })
  })

  it('defaults a duration exercise to seconds, not reps', () => {
    // A plank targeted at 8–12 "reps" would be nonsense (US-2.9).
    expect(itemFor(ex('Plank', { load_type: 'duration' }))).toMatchObject({ rep_low: 30, rep_high: 60 })
  })
})

describe('move / remove / patch', () => {
  const items = [item(shoulderPress), item(chestPress), item(ex('Lateral Raises'))]

  it('reorders, and clamps at both ends', () => {
    expect(move(items, 1, -1).map((i) => i.exercise.name)[0]).toBe('Chest Press Machine')
    expect(move(items, 0, -1)).toEqual(items)
    expect(move(items, 2, 1)).toEqual(items)
  })

  it('does not mutate its input', () => {
    move(items, 0, 1)
    expect(items[0]!.exercise.name).toBe('Shoulder Press Machine')
  })

  it('removes by index and patches one row', () => {
    expect(remove(items, 1)).toHaveLength(2)
    expect(patch(items, 0, { target_sets: 5 })[0]!.target_sets).toBe(5)
    expect(patch(items, 0, { target_sets: 5 })[1]!.target_sets).toBe(3)
  })
})

describe('add', () => {
  it('appends, because a newly picked exercise is last until moved', () => {
    const out = add([item(shoulderPress)], chestPress)
    expect(out.map((i) => i.exercise.name)).toEqual(['Shoulder Press Machine', 'Chest Press Machine'])
  })
})

// ---------------------------------------------------------------------------
// AC-2.11 / AC-2.16 — critical coach rules
// ---------------------------------------------------------------------------
describe('checkRules', () => {
  const orderRule: CriticalRule = {
    title: 'Shoulder press before chest',
    content: 'OHP / shoulder press must come before chest machines.',
    category: 'exercise_order',
  }
  const obliqueRule: CriticalRule = {
    title: 'No heavy oblique work',
    content: 'Core work is plank-based only. No heavy or weighted oblique loading.',
    category: 'safety',
  }

  it('flags a chest press placed above shoulder press, naming the rule', () => {
    const { violations } = checkRules([item(chestPress), item(shoulderPress)], [orderRule])
    expect(violations).toHaveLength(1)
    expect(violations[0]!.title).toBe('Shoulder press before chest')
    expect(violations[0]!.detail).toContain('Chest Press Machine is at 1')
  })

  it('passes the correct order', () => {
    expect(checkRules([item(shoulderPress), item(chestPress)], [orderRule]).violations).toEqual([])
  })

  it('finds the shoulder press even when movement_pattern is mis-imported', () => {
    /**
     * The regression. `Shoulder Press Machine` is seeded as `vertical_pull`, so a
     * checker requiring `vertical_push` found nothing and reported no violation —
     * a rule the user marked CRITICAL, silently unenforced.
     */
    const misTagged = ex('Shoulder Press Machine', {
      muscle_group: 'shoulders_front',
      movement_pattern: 'vertical_pull',
    })
    const { violations } = checkRules([item(chestPress), item(misTagged)], [orderRule])
    expect(violations).toHaveLength(1)
  })

  it('does not treat a front raise as the shoulder press the rule means', () => {
    const raise = ex('Front Raises', { muscle_group: 'shoulders_front', movement_pattern: 'isolation' })
    expect(checkRules([item(chestPress), item(raise)], [orderRule]).violations).toEqual([])
  })

  it('says nothing when only one of the two is present', () => {
    expect(checkRules([item(chestPress)], [orderRule]).violations).toEqual([])
  })

  it('flags loaded core work but allows a plank', () => {
    const abMachine = ex('Abs Machine', { muscle_group: 'abs_core', load_type: 'external_weight' })
    const plank = ex('Plank', { muscle_group: 'abs_core', load_type: 'duration' })
    expect(checkRules([item(abMachine)], [obliqueRule]).violations).toHaveLength(1)
    expect(checkRules([item(plank)], [obliqueRule]).violations).toEqual([])
  })

  it('names rules it cannot check rather than assuming they pass', () => {
    /**
     * A rule silently treated as satisfied is worse than no check at all — the
     * user would believe the plan had been vetted against it.
     */
    const vague: CriticalRule = { title: 'Always show last performance', content: 'Show LAST on every row.', category: 'progression' }
    const { violations, unchecked } = checkRules([item(chestPress)], [vague])
    expect(violations).toEqual([])
    expect(unchecked).toEqual(['Always show last performance'])
  })
})

describe('summarise / canStart', () => {
  it('counts exercises and total sets', () => {
    expect(summarise([item(chestPress), patch([item(shoulderPress)], 0, { target_sets: 4 })[0]!]))
      .toBe('2 exercises · 7 sets')
  })

  it('uses the singular for one of each', () => {
    expect(summarise(patch([item(chestPress)], 0, { target_sets: 1 }))).toBe('1 exercise · 1 set')
  })

  it('refuses to start an empty plan', () => {
    expect(canStart([])).toBe(false)
    expect(canStart([item(chestPress)])).toBe(true)
  })
})
