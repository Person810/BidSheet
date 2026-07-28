import type { SaveBidLineItemPayload } from './types/ipc';
import { parseManualFields, isManual } from './manualFields';
import { roundHours } from './round';

/**
 * Labor hours implied by a quantity and a production rate.
 *
 * This is a pricing rule, so it belongs in one place. It used to live only in
 * the line-item modal, which meant the grid's inline Qty cell — the advertised
 * spreadsheet-style edit — scaled material and left labor where it was:
 * doubling a 100 LF line's quantity doubled the pipe but kept 4 hours of
 * crew, and the shortfall flowed through section totals, overhead, profit,
 * bond and the grand total with no override marker to explain it.
 *
 * Returns `currentLaborHours` unchanged when there is no usable rate, or when
 * the user has pinned hours by typing them (`manual_fields` carries
 * 'laborHours') — an explicit override outranks the rule.
 */
export function laborHoursForQuantity(opts: {
  quantity: number;
  currentLaborHours: number;
  rate: { rate_per_hour?: number | null } | null | undefined;
  manualFields: string[];
  /**
   * The quantity before this edit. When supplied and unchanged, hours are left
   * alone: the rule is "recompute WHEN QUANTITY CHANGES", which is what the
   * modal does (it fires only from onQuantityChange). Without this, a
   * price-only edit in the grid re-derived hours from quantity/rate and
   * silently overwrote a value that had drifted — after someone edited the
   * production rate in the Labor page, say. Omit it to force the rule.
   */
  previousQuantity?: number;
}): number {
  if (opts.previousQuantity !== undefined && opts.previousQuantity === opts.quantity) {
    return opts.currentLaborHours;
  }
  const perHour = opts.rate?.rate_per_hour ?? 0;
  if (!(perHour > 0)) return opts.currentLaborHours;
  if (isManual(opts.manualFields, 'laborHours')) return opts.currentLaborHours;
  return roundHours(opts.quantity / perHour);
}

/**
 * Build a bid line-item save payload, defaulting every cost field to zero/null.
 * Callers supply only the fields that apply (description, quantity, a material,
 * a subcontractor cost, …); the rest fall back to "no cost" defaults.
 *
 * Use this for items created from a source that has no labor/equipment data —
 * trench-profile conversion, quotes → bid, and the plan-takeoff send-to-bid
 * flows — so the long block of zero defaults lives in exactly one place.
 */
export function buildLineItemPayload(
  fields: Pick<SaveBidLineItemPayload, 'sectionId' | 'jobId' | 'description' | 'quantity' | 'unit' | 'sortOrder'>
    & Partial<SaveBidLineItemPayload>,
): SaveBidLineItemPayload {
  return {
    materialId: null,
    materialUnitCost: 0,
    crewTemplateId: null,
    productionRateId: null,
    laborHours: 0,
    laborCostPerHour: 0,
    equipmentId: null,
    equipmentCostPerHour: 0,
    equipmentHours: 0,
    subcontractorCost: 0,
    notes: null,
    ...fields,
  };
}

/**
 * Map a snake_case `bid_line_items` row to a save payload, preserving every
 * cost field. `overrides` lets callers tweak individual fields (e.g. an inline
 * cell edit changing only quantity, or pinning jobId from a known context).
 * Overrides win over the row values.
 */
export function lineItemRowToPayload(
  row: any,
  overrides?: Partial<SaveBidLineItemPayload>,
): SaveBidLineItemPayload {
  return {
    id: row.id,
    sectionId: row.section_id,
    jobId: row.job_id,
    description: row.description,
    itemNumber: row.item_number || null,
    costCode: row.cost_code || null,
    quantity: row.quantity,
    unit: row.unit,
    sortOrder: row.sort_order,
    materialId: row.material_id || null,
    materialUnitCost: row.material_unit_cost,
    crewTemplateId: row.crew_template_id || null,
    productionRateId: row.production_rate_id || null,
    laborHours: row.labor_hours,
    laborCostPerHour: row.labor_cost_per_hour,
    equipmentId: row.equipment_id || null,
    equipmentCostPerHour: row.equipment_cost_per_hour,
    equipmentHours: row.equipment_hours,
    subcontractorCost: row.subcontractor_cost,
    notes: row.notes || null,
    // Preserve sticky overrides across round-trips (inline edits, undo/redo).
    manualFields: parseManualFields(row.manual_fields),
    ...overrides,
  };
}
