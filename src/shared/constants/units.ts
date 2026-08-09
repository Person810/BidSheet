import type { UnitSystem } from '../unitSystem';

/** Standard measurement units used across the application. */
export const UNITS = ['LF', 'EA', 'CYD', 'SY', 'TON', 'VF', 'LS', 'GAL', 'SF', 'HR'] as const;

// ---- System-scoped unit pickers ------------------------------------------
// Unit strings on catalog items and bid lines are identities, not
// measurements: a line in "m³" is quantified in cubic metres and never
// converts to "CY" (unlike dimension fields, which store imperial and convert
// at the display boundary — see shared/unitSystem.ts). So metric support here
// is a vocabulary question: pickers offer only the active system's units plus
// the system-neutral ones (EA, LS, HR). A row that already carries an
// out-of-system unit keeps it — `unitOptions` injects the current value so
// existing data always renders and survives an edit unchanged.

/** Picker options per system, most-used first (metric mirrors UNITS' order). */
const PICKER_UNITS: Record<UnitSystem, readonly string[]> = {
  imperial: UNITS,
  metric: ['m', 'EA', 'm³', 'm²', 't', 'LS', 'L', 'HR'],
};

/**
 * The unit options a <select> should offer: the active system's list, with
 * `current` prepended when it isn't in that list (existing out-of-system rows
 * must keep rendering their stored unit).
 */
export function unitOptions(system: UnitSystem, current?: string | null): string[] {
  const base = PICKER_UNITS[system];
  return current && !base.includes(current) ? [current, ...base] : [...base];
}

/** Default unit for a freshly opened form whose natural default is length. */
export function defaultUnit(system: UnitSystem): string {
  return system === 'metric' ? 'm' : 'LF';
}

// ---- Dimensional conversion factors -------------------------------------
// Takeoffs are measured in feet and inches but priced and reported in square
// and cubic yards. Naming these factors (and the helpers below) keeps the
// arithmetic self-documenting: `cubicFeetToYards(v)` says what a bare `v / 27`
// only implies, so a reader never has to recognize the magic number.

/** Inches in one foot. */
export const INCHES_PER_FOOT = 12;
/** Square feet in one square yard (3 ft × 3 ft). */
export const SQUARE_FEET_PER_SQUARE_YARD = 9;
/** Cubic feet in one cubic yard (3 ft × 3 ft × 3 ft). */
export const CUBIC_FEET_PER_CUBIC_YARD = 27;

/** Convert a length from inches to feet. */
export function inchesToFeet(inches: number): number {
  return inches / INCHES_PER_FOOT;
}

/** Convert an area from square feet to square yards. */
export function squareFeetToYards(squareFeet: number): number {
  return squareFeet / SQUARE_FEET_PER_SQUARE_YARD;
}

/** Convert a volume from cubic feet to cubic yards. */
export function cubicFeetToYards(cubicFeet: number): number {
  return cubicFeet / CUBIC_FEET_PER_CUBIC_YARD;
}

/** Standard open-cut nominal pipe sizes in inches. */
export const STANDARD_PIPE_SIZES_IN = [2, 3, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 30, 36, 42, 48];

