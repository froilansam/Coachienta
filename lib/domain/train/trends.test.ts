import { describe, expect, it } from 'vitest'
import type { MuscleWeek, SessionSummary, ShareRow, TopSet, TotalWeek } from '@/lib/db/queries/trends'
import {
  adherence,
  adherenceSummary,
  calendar,
  epley1rm,
  frequencySummary,
  isFullyAttributed,
  leadKind,
  mondayOf,
  progressionLines,
  progressionSubjects,
  rampOrder,
  stackByWeek,
} from './trends'

const mw = (week_start: string, muscle_group: string, volume_kg: number, set_count: number): MuscleWeek => ({
  week_start,
  muscle_group,
  volume_kg,
  set_count,
})
const tw = (week_start: string, volume_kg: number, set_count: number): TotalWeek => ({
  week_start,
  volume_kg,
  set_count,
})

describe('stackByWeek', () => {
  it('splits a week into segments, largest first', () => {
    const weeks = stackByWeek(
      [mw('2026-08-03', 'chest', 1000, 6), mw('2026-08-03', 'shoulders_side', 2000, 9)],
      [tw('2026-08-03', 3000, 15)],
      'volume_kg',
    )
    expect(weeks).toHaveLength(1)
    expect(weeks[0]!.segments.map((s) => s.key)).toEqual(['shoulders_side', 'chest'])
    expect(weeks[0]!.total).toBe(3000)
  })

  it('AC-2.14 — the parts add up to the total, and the difference is named', () => {
    const clean = stackByWeek([mw('2026-08-03', 'back', 500, 3)], [tw('2026-08-03', 500, 3)], 'volume_kg')
    expect(clean[0]!.unattributed).toBe(0)
    expect(isFullyAttributed(clean)).toBe(true)
  })

  it('surfaces a leak as a number rather than letting it hide', () => {
    // The spreadsheet's exact failure: 9,352 kg tagged outside the enum, and the
    // dashboard's "Other" row showed 0.
    const leaky = stackByWeek([mw('2026-08-03', 'back', 500, 3)], [tw('2026-08-03', 9852, 32)], 'volume_kg')
    expect(leaky[0]!.unattributed).toBe(9352)
    expect(isFullyAttributed(leaky)).toBe(false)
  })

  it('drops empty segments but keeps the week', () => {
    const weeks = stackByWeek([mw('2026-08-03', 'abs', 0, 4)], [tw('2026-08-03', 0, 4)], 'volume_kg')
    expect(weeks[0]!.segments).toHaveLength(0)
    expect(weeks[0]!.week_start).toBe('2026-08-03')
  })

  it('counts sets on the same footing as volume — the honest measure for abs', () => {
    const weeks = stackByWeek(
      [mw('2026-08-03', 'abs', 0, 9), mw('2026-08-03', 'chest', 4000, 6)],
      [tw('2026-08-03', 4000, 15)],
      'set_count',
    )
    // Abs lead on sets and are absent from volume — exactly the distinction §4.4 asks for.
    expect(weeks[0]!.segments[0]!.key).toBe('abs')
    expect(weeks[0]!.unattributed).toBe(0)
  })
})

describe('rampOrder', () => {
  it('is decided once for the whole range, not per bar', () => {
    const order = rampOrder(
      [
        mw('2026-07-27', 'chest', 100, 1),
        mw('2026-08-03', 'chest', 100, 1),
        mw('2026-08-03', 'back', 150, 1),
      ],
      'volume_kg',
    )
    // Back wins one week but chest wins the range, so chest keeps the first shade.
    expect(order).toEqual(['chest', 'back'])
  })
})

describe('epley1rm', () => {
  it('makes a heavy triple and a light twelve comparable', () => {
    expect(epley1rm(100, 3)).toBe(110)
    expect(epley1rm(70, 12)).toBe(98)
  })
  it('refuses to divide by a zero-rep set', () => {
    expect(epley1rm(100, 0)).toBe(0)
  })
})

const top = (over: Partial<TopSet> = {}): TopSet => ({
  exercise_id: 'e1',
  exercise_name: 'Shoulder Press Machine',
  muscle_group: 'shoulders_front',
  load_type: 'external_weight',
  gym_id: 'g1',
  gym_name: 'Anytime Shinjuku',
  performed_on: '2026-08-03',
  weight_kg: 50,
  reps: 10,
  duration_sec: null,
  ...over,
})

describe('progressionLines', () => {
  it('AC-2.5 — a gym switch is a separate line, never a step in one', () => {
    const { lines } = progressionLines(
      [
        top({ performed_on: '2026-07-01', gym_id: 'g1', gym_name: 'Old', weight_kg: 45 }),
        top({ performed_on: '2026-07-20', gym_id: 'g2', gym_name: 'New', weight_kg: 60 }),
      ],
      'e1',
    )
    expect(lines.map((l) => l.label).sort()).toEqual(['New', 'Old'])
    // 45 kg → 60 kg is a different pulley ratio, not a 33% strength jump.
    expect(lines.every((l) => l.points.length === 1)).toBe(true)
  })

  it('plots estimated 1RM so dropping reps to add load is not a regression', () => {
    const { lines, unit } = progressionLines(
      [
        top({ performed_on: '2026-07-01', weight_kg: 50, reps: 15 }),
        top({ performed_on: '2026-07-08', weight_kg: 60, reps: 10 }),
      ],
      'e1',
    )
    expect(unit).toBe('kg e1RM')
    const [a, b] = lines[0]!.points
    expect(b!.value).toBeGreaterThan(a!.value)
    expect(b!.label).toBe('60 kg × 10')
  })

  it('a duration exercise is plotted in seconds, never a fake weight', () => {
    const { lines, unit } = progressionLines(
      [
        top({ exercise_id: 'p', load_type: 'duration', weight_kg: null, reps: null, duration_sec: 45 }),
        top({ exercise_id: 'p', load_type: 'duration', weight_kg: null, reps: null, duration_sec: 60, performed_on: '2026-08-10' }),
      ],
      'p',
    )
    expect(unit).toBe('s')
    expect(lines[0]!.points.map((p) => p.value)).toEqual([45, 60])
  })

  it('assisted work says down is better', () => {
    const { unit, betterIsDown } = progressionLines([top({ load_type: 'assisted', weight_kg: 30 })], 'e1')
    expect(unit).toBe('kg assist')
    // Less assistance is stronger — the trap that would draw improvement as decline.
    expect(betterIsDown).toBe(true)
  })

  it('unweighted bodyweight work is plotted in reps', () => {
    const { unit, lines } = progressionLines(
      [top({ load_type: 'bodyweight', weight_kg: 0, reps: 8 })],
      'e1',
    )
    expect(unit).toBe('reps')
    expect(lines[0]!.points[0]!.label).toBe('8 reps')
  })

  it('sorts points by date whatever order the rows arrive in', () => {
    const { lines } = progressionLines(
      [top({ performed_on: '2026-08-10' }), top({ performed_on: '2026-07-01' })],
      'e1',
    )
    expect(lines[0]!.points.map((p) => p.on)).toEqual(['2026-07-01', '2026-08-10'])
  })
})

describe('progressionSubjects', () => {
  it('needs two days before it will draw a line', () => {
    const subjects = progressionSubjects([
      top({ exercise_id: 'a', performed_on: '2026-07-01' }),
      top({ exercise_id: 'a', performed_on: '2026-07-08' }),
      top({ exercise_id: 'b', exercise_name: 'Once', performed_on: '2026-07-01' }),
    ])
    expect(subjects.map((s) => s.id)).toEqual(['a'])
  })
})

// ---------------------------------------------------------------------------
const sess = (performed_on: string, volume_kg = 1000): SessionSummary => ({
  id: `s-${performed_on}-${volume_kg}`,
  performed_on,
  name: 'Push',
  gym_name: 'Anytime',
  started_at: null,
  completed_at: null,
  set_count: 12,
  volume_kg,
  pr_count: 0,
})

describe('calendar', () => {
  it('aligns to Monday and marks the 4-day target', () => {
    // 2026-08-06 is a Thursday; its week starts Monday 2026-08-03.
    const weeks = calendar(
      ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'].map((d) => sess(d)),
      '2026-08-06',
      1,
    )
    expect(weeks[0]!.week_start).toBe('2026-08-03')
    expect(weeks[0]!.sessions).toBe(4)
    expect(weeks[0]!.onTarget).toBe(true)
  })

  it('shows WHICH days, which a weekly count cannot', () => {
    const weeks = calendar([sess('2026-08-08'), sess('2026-08-09')], '2026-08-09', 1)
    const trained = weeks[0]!.days.filter((d) => d.sessions > 0).map((d) => d.on)
    // Both on the weekend — a different week from four spread out, same count.
    expect(trained).toEqual(['2026-08-08', '2026-08-09'])
  })

  it('marks days after today as filler, not as missed', () => {
    const weeks = calendar([], '2026-08-06', 1)
    expect(weeks[0]!.days.filter((d) => d.filler).map((d) => d.on)).toEqual(['2026-08-07', '2026-08-08', '2026-08-09'])
  })

  it('counts two sessions on one day separately', () => {
    // Allowed by design; the spreadsheet double-counted duplicate-date rows instead.
    const weeks = calendar([sess('2026-08-04', 900), sess('2026-08-04', 1100)], '2026-08-06', 1)
    const day = weeks[0]!.days.find((d) => d.on === '2026-08-04')!
    expect(day.sessions).toBe(2)
    expect(day.volume).toBe(2000)
  })

  it('summarises without counting the unfinished week as a miss', () => {
    const weeks = calendar([], '2026-08-06', 2)
    expect(frequencySummary(weeks)).toBe('0 of 2 weeks hit 4 · 0.0 a week on average')
  })
})

describe('mondayOf', () => {
  it('holds a Monday still and pulls a Sunday back six days', () => {
    expect(mondayOf('2026-08-03')).toBe('2026-08-03')
    expect(mondayOf('2026-08-09')).toBe('2026-08-03')
  })
})

// ---------------------------------------------------------------------------
const share = (rank: number, muscle_group: string, share_pct: number): ShareRow => ({
  rank,
  muscle_group,
  volume_kg: share_pct * 100,
  share_pct,
})

describe('adherence', () => {
  it('names the group that is ranked high and trained low', () => {
    const rows = adherence([
      share(1, 'shoulders_side', 10),
      share(2, 'back', 40),
      share(3, 'chest_upper', 35),
    ])
    const shoulders = rows[0]!
    expect(shoulders.rank).toBe(1)
    expect(shoulders.actualRank).toBe(3)
    expect(shoulders.verdict).toBe('under')
    expect(adherenceSummary(rows)).toContain('ranked #1 but received the 3rd most volume (10%)')
  })

  it('treats one place of drift as noise', () => {
    const rows = adherence([share(1, 'a', 30), share(2, 'b', 35), share(3, 'c', 20)])
    expect(rows.map((r) => r.verdict)).toEqual(['on', 'on', 'on'])
    expect(adherenceSummary(rows)).toBe('Volume matches your priority order.')
  })

  it('says nothing when no priorities are set', () => {
    expect(adherenceSummary(adherence([]))).toBeNull()
  })

  it('a ranked group with no volume at all is UNDER, never "on order"', () => {
    // Ties at 0% leave every untrained group within one place of its own rank, so the
    // drift rule alone called them "ON ORDER" — i.e. the order was honoured by not
    // training them.
    const rows = adherence([share(1, 'a', 60), share(2, 'b', 40), share(3, 'c', 0)])
    expect(rows.find((r) => r.label === 'c')?.verdict).toBe('under')
  })
})

describe('leadKind', () => {
  it('leads with the strongest claim the set makes', () => {
    expect(leadKind(['volume_set', 'weight'])).toBe('weight')
    expect(leadKind(['reps_at_weight', 'volume_set'])).toBe('reps_at_weight')
  })
})
