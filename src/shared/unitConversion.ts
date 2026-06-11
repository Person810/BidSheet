/**
 * Unit handling between material pricing units and bid line units.
 *
 * Aggregates (stone, sand, fill) are bought by the TON but taken off
 * by the cubic yard. TON-priced materials can carry an optional second
 * price per CY (cost_per_cy), entered directly or kept in sync from
 * the per-ton price via an optional density (tons_per_cy). Cubic-yard
 * line quantities are priced with the per-CY price so they are never
 * multiplied by a raw $/TON rate.
 */

const CUBIC_YARD_UNITS = new Set(['CY', 'CYD']);

export function isCubicYards(unit: string | null | undefined): boolean {
  return !!unit && CUBIC_YARD_UNITS.has(unit.toUpperCase());
}

export interface ConvertibleMaterial {
  unit: string;
  default_unit_cost: number;
  cost_per_cy?: number | null;
  tons_per_cy?: number | null;
}

export interface EffectiveCost {
  cost: number;
  /** True when the per-CY price (direct or density-derived) was used */
  converted: boolean;
}

/**
 * Price for one `lineUnit` of the material. Returns the catalog price
 * untouched unless the line is in cubic yards and the material is
 * priced per TON: then the direct per-CY price wins, falling back to
 * per-ton price x density when only the density is known.
 */
export function effectiveMaterialUnitCost(
  material: ConvertibleMaterial,
  lineUnit: string | null | undefined
): EffectiveCost {
  if (isCubicYards(lineUnit) && material.unit === 'TON') {
    if (material.cost_per_cy && material.cost_per_cy > 0) {
      return { cost: material.cost_per_cy, converted: true };
    }
    if (material.tons_per_cy && material.tons_per_cy > 0) {
      return {
        cost: Math.round(material.default_unit_cost * material.tons_per_cy * 100) / 100,
        converted: true,
      };
    }
  }
  return { cost: material.default_unit_cost, converted: false };
}
