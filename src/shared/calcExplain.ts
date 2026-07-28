/**
 * "Show the math" (§5) — a small, shared model for explaining any calculated
 * number as its substituted arithmetic. The pure calc modules (bidCalc,
 * crewCost, trenchCalc) and the line-item rollups produce a CalcBreakdown on
 * demand; a renderer popover displays it. The fast number paths are untouched —
 * these explainers re-derive the breakdown only when the user opens it.
 */

export interface BreakdownLine {
  label: string;
  /** Pre-formatted value (already run through fmtMoney/fmtNum). */
  value: string;
  /** 'term' (an input), 'result' (the emphasized answer), or 'note'. */
  kind?: 'term' | 'result' | 'note';
}

export interface CalcBreakdown {
  /** Human-readable formula, e.g. "Labor hours = quantity ÷ production rate". */
  formula: string;
  lines: BreakdownLine[];
  /** Optional caveat/assumption shown under the lines. */
  note?: string;
}

// ---- Formatting (shared, renderer-independent) -----------------------------

/** USD, mirroring renderer formatCurrency so popovers match the grid. */
/**
 * Coerce anything to a finite number, defaulting to 0.
 *
 * These formatters are typed `number` but are fed values that came off a
 * sync snapshot, a CSV import, or a JSON column — a string reaches
 * `(n).toLocaleString()` and String.prototype.toLocaleString hands it
 * straight back, unformatted and unescaped. That is how a crafted
 * `total_cost` ends up interpolated verbatim into the generated PDF
 * document. Coercing here means every caller prints a number or prints
 * "$0.00"; it never prints its input.
 */
function toFinite(n: unknown): number {
  if (typeof n === 'number') return Number.isFinite(n) ? n : 0;
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

export function fmtMoney(n: number, opts?: { maximumFractionDigits?: number }): string {
  return toFinite(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', ...opts });
}

/** Plain number with thousands separators, up to `maxFrac` decimals. */
export function fmtNum(n: number, maxFrac = 2): string {
  return toFinite(n).toLocaleString('en-US', { maximumFractionDigits: maxFrac });
}

/** A number with a trailing unit, e.g. "1,250 LF" or "6.5 ft". */
export function fmtQty(n: number, unit: string, maxFrac = 2): string {
  return `${fmtNum(n, maxFrac)}${unit ? ` ${unit}` : ''}`;
}

// ---- Generic builders ------------------------------------------------------

/** a × b = result. Each operand and the result carry their own label/value. */
export function explainProduct(
  formula: string,
  a: BreakdownLine, b: BreakdownLine, result: BreakdownLine, note?: string,
): CalcBreakdown {
  return {
    formula,
    lines: [
      { ...a, kind: 'term' },
      { ...b, kind: 'term' },
      { ...result, kind: 'result' },
    ],
    note,
  };
}

/** dividend ÷ divisor = result. */
export function explainQuotient(
  formula: string,
  dividend: BreakdownLine, divisor: BreakdownLine, result: BreakdownLine, note?: string,
): CalcBreakdown {
  return {
    formula,
    lines: [
      { ...dividend, kind: 'term' },
      { ...divisor, kind: 'term' },
      { ...result, kind: 'result' },
    ],
    note,
  };
}

/** Sum of parts = result. */
export function explainSum(
  formula: string, parts: BreakdownLine[], result: BreakdownLine, note?: string,
): CalcBreakdown {
  return {
    formula,
    lines: [...parts.map((p) => ({ ...p, kind: 'term' as const })), { ...result, kind: 'result' }],
    note,
  };
}

/**
 * `base × pct% = result`, where pct is derived from base and result so it
 * stays honest even when per-section overrides blend the rate. `baseLabel`
 * names the base (e.g. "Direct cost + escalation").
 */
export function explainPercentOf(
  label: string, baseLabel: string, base: number, result: number, note?: string,
): CalcBreakdown {
  const pct = base > 0 ? (result / base) * 100 : 0;
  return {
    formula: `${label} = ${baseLabel.toLowerCase()} × rate`,
    lines: [
      { label: baseLabel, value: fmtMoney(base), kind: 'term' },
      { label: 'Rate', value: `${fmtNum(pct, 3)}%`, kind: 'term' },
      { label, value: fmtMoney(result), kind: 'result' },
    ],
    note,
  };
}
