/**
 * Bid line-item cost rollup — the single source of truth for turning a line's
 * quantities and unit costs into its material/labor/equipment totals, total
 * cost, and per-unit cost.
 *
 * This same arithmetic was previously hand-written in the save handler, the
 * price-import update/propagate paths, and the line-item editor's live preview.
 * Keeping it in one place means the database, an imported price, and the modal
 * preview can never drift — and the quantity==0 guard on unit cost lives once.
 */

export interface LineItemCostInputs {
  quantity: number;
  materialUnitCost: number;
  laborHours: number;
  laborCostPerHour: number;
  equipmentHours: number;
  equipmentCostPerHour: number;
  subcontractorCost: number;
}

/** The four cost components that sum to a line's total cost. */
export interface LineItemCostParts {
  materialTotal: number;
  laborTotal: number;
  equipmentTotal: number;
  subcontractorCost: number;
}

export interface LineItemCost extends LineItemCostParts {
  totalCost: number;
  /** Burdened cost for one unit; 0 when quantity is 0 (never divides by zero). */
  unitCost: number;
}

/**
 * Sum the cost components and derive the per-unit cost. Use this when the
 * component totals are already known (e.g. a price import that changes only the
 * material price but keeps the stored labor/equipment totals).
 */
export function rollupLineItemCost(
  parts: LineItemCostParts,
  quantity: number,
): { totalCost: number; unitCost: number } {
  const totalCost =
    parts.materialTotal + parts.laborTotal + parts.equipmentTotal + parts.subcontractorCost;
  return { totalCost, unitCost: quantity > 0 ? totalCost / quantity : 0 };
}

/**
 * Full line-item cost from raw inputs: material = quantity × unit cost,
 * labor/equipment = hours × cost/hour, plus the subcontractor lump sum.
 * Every input is missing-tolerant (undefined/null/NaN → 0), not just the
 * subcontractor cost: one undefined field otherwise yields a NaN that
 * propagates through section totals into the whole bid summary.
 */
export function computeLineItemCost(input: LineItemCostInputs): LineItemCost {
  const n = (v: number) => (Number.isFinite(v) ? v : 0);
  const quantity = n(input.quantity);
  const parts: LineItemCostParts = {
    materialTotal: quantity * n(input.materialUnitCost),
    laborTotal: n(input.laborHours) * n(input.laborCostPerHour),
    equipmentTotal: n(input.equipmentHours) * n(input.equipmentCostPerHour),
    subcontractorCost: n(input.subcontractorCost),
  };
  return { ...parts, ...rollupLineItemCost(parts, quantity) };
}
