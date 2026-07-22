/**
 * Rounding helpers for derived quantities.
 *
 * Production hours are *priced* (hours × cost/hour), so they must keep enough
 * precision that small quantities don't collapse to zero. A line of 4 EA at a
 * 100 EA/hr production rate is 0.04 hr; rounded to one decimal that becomes 0,
 * silently zeroing the labor (or equipment) cost. Four decimals preserves
 * those small-but-real costs while keeping the displayed value tidy.
 *
 * Single source of truth so the assembly expansion and the line-item editor
 * round labor/equipment hours the same way and always agree on cost.
 */
export function roundHours(n: number): number {
  // Half-away-from-zero on both signs (Math.round alone sends negative
  // halves toward +∞), so deduct lines round symmetrically with adds.
  return Math.sign(n) * Math.round(Math.abs(n) * 10000) / 10000;
}
