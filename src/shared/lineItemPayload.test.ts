import { describe, expect, it } from 'vitest';
import { buildLineItemPayload, lineItemRowToPayload } from './lineItemPayload';

const required = { sectionId: 1, jobId: 2, description: 'Item', quantity: 5, unit: 'LF', sortOrder: 0 } as const;

describe('buildLineItemPayload', () => {
  it('defaults every cost field to zero/null when only the basics are supplied', () => {
    const p = buildLineItemPayload({ ...required });
    expect(p).toMatchObject({
      sectionId: 1,
      jobId: 2,
      description: 'Item',
      quantity: 5,
      unit: 'LF',
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
    });
  });

  it('lets supplied fields override the zero defaults', () => {
    const p = buildLineItemPayload({ ...required, subcontractorCost: 500, notes: 'sub quote' });
    expect(p.subcontractorCost).toBe(500);
    expect(p.notes).toBe('sub quote');
    // Untouched cost fields still default.
    expect(p.materialUnitCost).toBe(0);
    expect(p.laborHours).toBe(0);
  });
});

describe('lineItemRowToPayload', () => {
  const row = {
    id: 11,
    section_id: 3,
    job_id: 4,
    description: 'Pipe',
    item_number: 'A-1',
    cost_code: 'CC10',
    quantity: 100,
    unit: 'LF',
    sort_order: 2,
    material_id: 7,
    material_unit_cost: 3.25,
    crew_template_id: 9,
    production_rate_id: 12,
    labor_hours: 4,
    labor_cost_per_hour: 50,
    equipment_id: 6,
    equipment_cost_per_hour: 125,
    equipment_hours: 8,
    subcontractor_cost: 0,
    notes: 'note',
    manual_fields: '["laborHours","materialUnitCost"]',
  };

  it('maps a snake_case row to a camelCase payload, preserving cost fields', () => {
    const p = lineItemRowToPayload(row);
    expect(p).toMatchObject({
      id: 11,
      sectionId: 3,
      jobId: 4,
      description: 'Pipe',
      itemNumber: 'A-1',
      costCode: 'CC10',
      quantity: 100,
      materialId: 7,
      materialUnitCost: 3.25,
      crewTemplateId: 9,
      productionRateId: 12,
      laborHours: 4,
      laborCostPerHour: 50,
      equipmentId: 6,
      equipmentCostPerHour: 125,
      equipmentHours: 8,
    });
  });

  it('parses the stored manual-fields JSON into the sticky-override list', () => {
    const p = lineItemRowToPayload(row);
    expect(p.manualFields).toEqual(['laborHours', 'materialUnitCost']);
  });

  it('coalesces falsy foreign keys and optional text to null', () => {
    const p = lineItemRowToPayload({ ...row, material_id: 0, crew_template_id: null, item_number: '', notes: '' });
    expect(p.materialId).toBeNull();
    expect(p.crewTemplateId).toBeNull();
    expect(p.itemNumber).toBeNull();
    expect(p.notes).toBeNull();
  });

  it('lets overrides win over the row values', () => {
    const p = lineItemRowToPayload(row, { quantity: 250, jobId: 99 });
    expect(p.quantity).toBe(250);
    expect(p.jobId).toBe(99);
    // Non-overridden fields keep the row value.
    expect(p.materialUnitCost).toBe(3.25);
  });

  it('returns an empty override list when manual_fields is absent', () => {
    const p = lineItemRowToPayload({ ...row, manual_fields: null });
    expect(p.manualFields).toEqual([]);
  });
});
