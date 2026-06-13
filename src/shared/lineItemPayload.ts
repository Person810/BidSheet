import type { SaveBidLineItemPayload } from './types/ipc';

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
    ...overrides,
  };
}
