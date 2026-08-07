/**
 * Display formatters. No component formats numbers inline.
 *
 * Default precision: 1 decimal below 1,000, none at or above.
 *
 * The threshold is 1,000 and not 100 deliberately — macros live in the
 * 100–300 g range where the tenths are real (`168.3 g` of protein, not `168`),
 * while calories live in the thousands where a decimal is noise (`2,090`).
 */
const autoDecimals = (v: number) => (Math.abs(v) >= 1000 ? 0 : 1)

export const fmtNum = (v: number | null, decimals?: number): string => {
  if (v === null || Number.isNaN(v)) return '—'

  // Explicit `decimals` means EXACTLY that many — for a fixed-decimal column
  // where every row must align on the point (Bloomberg-style).
  if (decimals !== undefined) {
    return v.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
  }

  // Omitted means auto, with no trailing zero: `160`, not `160.0`.
  return v.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: autoDecimals(v),
  })
}

/** Always shows a sign. Uses a true minus (−), not a hyphen. */
export const fmtSigned = (v: number, decimals?: number): string =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), decimals)}`
