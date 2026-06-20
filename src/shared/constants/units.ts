/** Standard measurement units used across the application. */
export const UNITS = ['LF', 'EA', 'CYD', 'SY', 'TON', 'VF', 'LS', 'GAL', 'SF', 'HR'] as const;

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
