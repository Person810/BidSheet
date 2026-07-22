/**
 * Parse a number the user typed into a text/number input.
 *
 * `parseFloat` is the wrong tool for user-entered money and quantities: it
 * stops at the first character it can't consume, so a copy-pasted, formatted
 * value like "1,250" silently parses to `1` — and callers that only check
 * `Number.isFinite(...)` happily commit that corrupted value. `parseFloat`
 * also accepts trailing garbage ("12abc" -> 12).
 *
 * This helper strips grouping commas ("1,250" / "1,250.50" -> 1250 / 1250.5),
 * then rejects anything that isn't a clean decimal number by returning `NaN`,
 * so callers can distinguish "no valid number" from a real value instead of
 * truncating garbage. The app uses "." as the decimal separator throughout
 * (imperial and metric), so only "," is treated as a thousands separator.
 *
 * Mid-typing states stay usable so per-keystroke onChange handlers don't
 * flicker: a trailing dot ("1.") parses to 1 like `parseFloat` did, while
 * "", "-" and "." alone are not yet numbers and yield `NaN` (callers
 * typically fall back to 0 with `|| 0`).
 */
export function parseNumericInput(raw: string): number {
  if (typeof raw !== 'string') return NaN;
  const cleaned = raw.trim().replace(/,/g, '');
  if (cleaned === '') return NaN;
  // Well-formed decimal only: optional sign, then digits with an optional
  // (possibly empty) fractional part, or a leading-dot fraction. Accepts a
  // trailing dot ("1."); rejects "1abc", "1.2.3", "-", "." alone.
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) return NaN;
  return Number(cleaned);
}
