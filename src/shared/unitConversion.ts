/**
 * Unit handling between material pricing units and bid line units.
 *
 * Aggregates (stone, sand, fill) are bought by the TON but taken off
 * by the cubic yard. TON-priced materials can carry an optional second
 * price per CY (cost_per_cy), entered directly or kept in sync from
 * the per-ton price via an optional density (tons_per_cy). Cubic-yard
 * line quantities are priced with the per-CY price so they are never
 * multiplied by a raw $/TON rate.
 *
 * Metric tonne-priced materials (unit `t`) mirror the same pair: for them
 * cost_per_cy holds $ per m³ and tons_per_cy holds t per m³ — the columns
 * keep their imperial names, and the material's unit says which volume
 * they pair with. A volume line in the other system (a CY line on a tonne
 * material, or an m³ line on a TON material) prices via the exact CY↔m³
 * conversion.
 */

import { CUBIC_METERS_PER_CY } from './unitSystem';

const CUBIC_YARD_UNITS = new Set(['CY', 'CYD']);
const CUBIC_METER_UNITS = new Set(['M³', 'M3']);

export function isCubicYards(unit: string | null | undefined): boolean {
  return !!unit && CUBIC_YARD_UNITS.has(unit.toUpperCase());
}

export function isCubicMeters(unit: string | null | undefined): boolean {
  return !!unit && CUBIC_METER_UNITS.has(unit.toUpperCase());
}

/** True for mass pricing units: imperial short ton (TON) / metric tonne (t). */
export function isMassUnit(unit: string | null | undefined): boolean {
  if (!unit) return false;
  const u = unit.toUpperCase();
  return u === 'TON' || u === 'T';
}

export interface ConvertibleMaterial {
  unit: string;
  default_unit_cost: number;
  /** $ per CY for TON materials, $ per m³ for tonne (t) materials */
  cost_per_cy?: number | null;
  /** tons per CY for TON materials, t per m³ for tonne (t) materials */
  tons_per_cy?: number | null;
}

export interface EffectiveCost {
  cost: number;
  /** True when the volume price (direct or density-derived) was used */
  converted: boolean;
}

/**
 * Price for one `lineUnit` of the material. Returns the catalog price
 * untouched unless the line is a volume (CY/m³) and the material is
 * priced by mass (TON/t): then the direct volume price wins, falling
 * back to mass price x density when only the density is known, with an
 * exact CY↔m³ conversion when the line's volume unit is in the other
 * system.
 */
export function effectiveMaterialUnitCost(
  material: ConvertibleMaterial,
  lineUnit: string | null | undefined
): EffectiveCost {
  const wantCY = isCubicYards(lineUnit);
  const wantM3 = isCubicMeters(lineUnit);
  if ((wantCY || wantM3) && isMassUnit(material.unit)) {
    // Native volume price: $/CY for TON materials, $/m³ for tonne materials
    const native =
      material.cost_per_cy && material.cost_per_cy > 0
        ? material.cost_per_cy
        : material.tons_per_cy && material.tons_per_cy > 0
          ? Math.round(material.default_unit_cost * material.tons_per_cy * 100) / 100
          : null;
    if (native != null) {
      const nativeIsCY = material.unit.toUpperCase() === 'TON';
      if (nativeIsCY === wantCY) {
        return { cost: native, converted: true };
      }
      const cost = wantCY ? native * CUBIC_METERS_PER_CY : native / CUBIC_METERS_PER_CY;
      return { cost: Math.round(cost * 100) / 100, converted: true };
    }
  }
  return { cost: material.default_unit_cost, converted: false };
}
