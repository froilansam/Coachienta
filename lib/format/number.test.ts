import { describe, expect, it } from 'vitest'
import { fmtNum, fmtSigned } from './number'

describe('fmtNum', () => {
  it('keeps the tenths on macro-range values', () => {
    // Regression: an earlier heuristic dropped decimals at >=100, so 168.3 g of
    // protein rendered as "168" — precision lost on exactly the numbers that
    // matter most in this app.
    expect(fmtNum(168.3)).toBe('168.3')
    expect(fmtNum(196.7)).toBe('196.7')
    expect(fmtNum(70.4)).toBe('70.4')
  })

  it('drops the decimal in the thousands, where it is noise', () => {
    expect(fmtNum(2090)).toBe('2,090')
    expect(fmtNum(4180)).toBe('4,180')
  })

  it('never emits a trailing .0 on a whole number', () => {
    expect(fmtNum(160)).toBe('160')
    expect(fmtNum(130)).toBe('130')
  })

  it('honours an explicit fixed precision for aligned columns', () => {
    expect(fmtNum(160, 2)).toBe('160.00')
    expect(fmtNum(168.3, 2)).toBe('168.30')
    expect(fmtNum(160, 0)).toBe('160')
  })

  it('renders a dash for null — never 0', () => {
    // A missing weigh-in is not 0 kg. Substituting 0 would put a cliff in
    // every chart.
    expect(fmtNum(null)).toBe('—')
    expect(fmtNum(Number.NaN)).toBe('—')
    expect(fmtNum(0)).toBe('0')
  })
})

describe('fmtSigned', () => {
  it('always shows a sign, using a true minus', () => {
    expect(fmtSigned(8.3)).toBe('+8.3')
    expect(fmtSigned(-93.3)).toBe('−93.3')   // U+2212, not a hyphen
    expect(fmtSigned(-93.3).charAt(0)).toBe('−')
  })

  it('shows no sign at zero', () => {
    expect(fmtSigned(0)).toBe('0')
  })
})
