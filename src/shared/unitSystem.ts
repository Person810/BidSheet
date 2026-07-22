/**
 * Display-boundary unit conversion between the canonical imperial units
 * everything is stored and calculated in, and the metric units a metric-mode
 * user sees (#97).
 *
 * The rule: storage and the calc engines stay imperial forever (same idea as
 * storing timestamps in UTC); metric is purely presentational. A metric user
 * types 0.9 m into a depth field, it is stored as feet at full precision, and
 * every render converts back — so 0.9 m always round-trips to exactly 0.9 m
 * and flipping the setting never reinterprets stored data.
 *
 * Conversion rules that keep this exact:
 *  - Factors are exact by definition (1 in = 25.4 mm, 1 ft = 0.3048 m);
 *    everything else is derived from those two.
 *  - Round only at render, never before storing.
 *  - Convert totals, not addends — sum in canonical units, convert once.
 *  - Nominal pipe sizes are a lookup (DN200 ↔ 8"), never arithmetic.
 */

// ---- The setting -----------------------------------------------------------

export type UnitSystem = 'imperial' | 'metric';

export const DEFAULT_UNIT_SYSTEM: UnitSystem = 'imperial';

/** Parse the app_settings.unit_system column (or any untrusted value). */
export function parseUnitSystem(raw: unknown): UnitSystem {
  return raw === 'metric' ? 'metric' : 'imperial';
}

// ---- Exact conversion factors ----------------------------------------------

/** 1 ft = 0.3048 m, exact by international definition (1959). */
export const METERS_PER_FOOT = 0.3048;
/** 1 in = 25.4 mm, exact by international definition (1959). */
export const MM_PER_INCH = 25.4;
/** Derived: (0.3048 m)² per square foot. */
export const SQUARE_METERS_PER_SF = METERS_PER_FOOT * METERS_PER_FOOT;
/** Derived: 9 square feet × (0.3048 m)² per square yard. */
export const SQUARE_METERS_PER_SY = 9 * SQUARE_METERS_PER_SF;
/** Derived: 27 cubic feet × (0.3048 m)³ per cubic yard. */
export const CUBIC_METERS_PER_CY = 27 * METERS_PER_FOOT ** 3;

// ---- Quantity kinds --------------------------------------------------------

/**
 * The canonical unit a stored number is in. Length in feet appears twice
 * because dimensions ("ft") and linear runs ("LF") label differently even
 * though they convert identically; same for SF vs formwork SFCA.
 */
export type QuantityKind = 'ft' | 'lf' | 'in' | 'sf' | 'sfca' | 'sy' | 'cy';

/** Metric units per one canonical unit, by kind. */
const METRIC_PER_CANONICAL: Record<QuantityKind, number> = {
  ft: METERS_PER_FOOT,
  lf: METERS_PER_FOOT,
  in: MM_PER_INCH,
  sf: SQUARE_METERS_PER_SF,
  sfca: SQUARE_METERS_PER_SF,
  sy: SQUARE_METERS_PER_SY,
  cy: CUBIC_METERS_PER_CY,
};

const LABELS: Record<QuantityKind, { imperial: string; metric: string }> = {
  ft: { imperial: 'ft', metric: 'm' },
  lf: { imperial: 'LF', metric: 'm' },
  in: { imperial: 'in', metric: 'mm' },
  sf: { imperial: 'SF', metric: 'm²' },
  sfca: { imperial: 'SFCA', metric: 'm²' },
  sy: { imperial: 'SY', metric: 'm²' },
  cy: { imperial: 'CY', metric: 'm³' },
};

/** The unit label to show next to a value of `kind`: "CY" or "m³". */
export function unitLabel(kind: QuantityKind, system: UnitSystem): string {
  return LABELS[kind][system];
}

// ---- Conversion ------------------------------------------------------------

/** Canonical (imperial) value → the number to display in `system`. Unrounded. */
export function convertQty(canonical: number, kind: QuantityKind, system: UnitSystem): number {
  return system === 'metric' ? canonical * METRIC_PER_CANONICAL[kind] : canonical;
}

/** A number the user typed in `system`'s units → canonical value to store. */
export function fromDisplay(display: number, kind: QuantityKind, system: UnitSystem): number {
  return system === 'metric' ? display / METRIC_PER_CANONICAL[kind] : display;
}

/**
 * Canonical value → the number an *input field* should show. Rounds away
 * float64 conversion noise (to 6 decimals) so a stored fromDisplay(0.9)
 * renders as exactly 0.9, letting controlled number inputs round-trip
 * keystrokes without clobbering what the user typed.
 */
export function toDisplay(canonical: number, kind: QuantityKind, system: UnitSystem): number {
  return roundTo(convertQty(canonical, kind, system), 6);
}

/**
 * Round to `decimals` places, dropping the trailing zeros String() would.
 * Half-away-from-zero on both signs: bare Math.round sends negative halves
 * toward +∞, so a credit/deduct quantity would round asymmetrically against
 * the equivalent positive one.
 */
export function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.sign(n) * Math.round(Math.abs(n) * f) / f;
}

/**
 * Render-ready quantity string: converts, rounds to at most `decimals`
 * places (no trailing zeros), labels. formatQty(37.04, 'cy', 'metric', 2)
 * → "28.32 m³"; formatQty(37, 'cy', 'imperial') → "37 CY".
 */
export function formatQty(
  canonical: number,
  kind: QuantityKind,
  system: UnitSystem,
  decimals = 2
): string {
  return `${roundTo(convertQty(canonical, kind, system), decimals)} ${unitLabel(kind, system)}`;
}

// ---- Engine emissions (send-to-bid) ----------------------------------------
// Engines (trench profiles, plan takeoff) compute in canonical imperial, but
// the bid lines they create are real stored data whose unit is an identity —
// a metric-mode user must receive genuinely metric lines, not imperial lines
// wearing a metric label. These helpers convert once, at creation.

/**
 * Quantity + unit string for an emitted bid line. Imperial passes both
 * through untouched — including the caller's historical unit spelling
 * ('CY' vs 'CYD') — so existing sends stay byte-identical. Metric converts
 * and rounds to 2 decimals: unlike pure display values, a bid quantity is
 * stored and user-editable, so it rounds once here rather than at render.
 */
export function bidLineQty(
  quantity: number,
  kind: QuantityKind,
  system: UnitSystem,
  imperialUnit?: string,
): { quantity: number; unit: string } {
  if (system !== 'metric') {
    return { quantity, unit: imperialUnit ?? unitLabel(kind, 'imperial') };
  }
  return {
    quantity: roundTo(convertQty(quantity, kind, system), 2),
    unit: unitLabel(kind, 'metric'),
  };
}

/**
 * Catalog price per imperial unit → exact price per the matching metric unit,
 * rounded to cents: $100/CY → $130.80/m³. Per-unit prices divide where
 * quantities multiply. Same-dimension conversion only — cross-dimension
 * pricing (TON→CY, t→m³) needs a material density and lives in
 * unitConversion.ts.
 */
export function metricUnitPrice(costPerImperialUnit: number, kind: QuantityKind): number {
  return roundTo(costPerImperialUnit / METRIC_PER_CANONICAL[kind], 2);
}

// ---- Nominal pipe sizes ----------------------------------------------------

/**
 * Nominal imperial pipe size (inches) → DN designation. Nominal sizes are
 * trade identities, not measurements — DN300 pairs with 12" even though
 * 12 in = 304.8 mm — so this is a lookup table, never arithmetic.
 */
const DN_BY_NOMINAL_INCH: Record<number, number> = {
  0.5: 15, 0.75: 20, 1: 25, 1.25: 32, 1.5: 40, 2: 50, 2.5: 65, 3: 80,
  3.5: 90, 4: 100, 5: 125, 6: 150, 8: 200, 10: 250, 12: 300, 14: 350,
  15: 375, 16: 400, 18: 450, 20: 500, 21: 525, 24: 600, 27: 675, 30: 750,
  33: 825, 36: 900, 42: 1050, 48: 1200, 54: 1350, 60: 1500, 72: 1800,
};

/** DN designation → nominal imperial inches (reverse lookup); undefined for
 *  non-standard DNs. Lets "DN200 PVC" catalog names resolve to the canonical
 *  nominal size the trench engine works in. */
export function nominalInchForDN(dn: number): number | undefined {
  for (const [inch, d] of Object.entries(DN_BY_NOMINAL_INCH)) {
    if (d === dn) return Number(inch);
  }
  return undefined;
}

/**
 * Display a nominal pipe size: 8 → `8"` imperial, `DN200` metric. Sizes
 * without a standard DN pairing fall back to the true millimetre conversion
 * so nothing ever renders as inches to a metric user.
 */
export function formatPipeSize(nominalIn: number, system: UnitSystem): string {
  if (system !== 'metric') return `${nominalIn}"`;
  const dn = DN_BY_NOMINAL_INCH[nominalIn];
  return dn !== undefined ? `DN${dn}` : `${roundTo(nominalIn * MM_PER_INCH, 0)} mm`;
}

// ---- Depth bands -----------------------------------------------------------

/**
 * Label a trench depth band ("5–10 ft" / "1.5–3 m", open-ended "20+ ft" /
 * "6.1+ m"). Imperial matches the labels trenchCalc bakes into DepthZone;
 * metric converts the band bounds and shows one decimal — the 5/10/15/20 ft
 * OSHA-style breaks land on 1.5/3/4.6/6.1 m.
 */
export function formatDepthBand(loFt: number, hiFt: number, system: UnitSystem): string {
  const cv = (v: number) =>
    system === 'metric' ? roundTo(v * METERS_PER_FOOT, 1) : roundTo(v, 0);
  const unit = unitLabel('ft', system);
  return hiFt === Infinity ? `${cv(loFt)}+ ${unit}` : `${cv(loFt)}–${cv(hiFt)} ${unit}`;
}
