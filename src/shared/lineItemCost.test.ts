import { describe, expect, it } from 'vitest';
import { computeLineItemCost, rollupLineItemCost } from './lineItemCost';

describe('computeLineItemCost', () => {
  it('rolls material, labor, equipment, and subcontractor into total and unit cost', () => {
    const c = computeLineItemCost({
      quantity: 100,
      materialUnitCost: 5,
      laborHours: 10,
      laborCostPerHour: 80,
      equipmentHours: 4,
      equipmentCostPerHour: 50,
      subcontractorCost: 200,
    });
    expect(c.materialTotal).toBe(500);
    expect(c.laborTotal).toBe(800);
    expect(c.equipmentTotal).toBe(200);
    expect(c.subcontractorCost).toBe(200);
    expect(c.totalCost).toBe(1700);
    expect(c.unitCost).toBe(17); // 1700 / 100
  });

  it('never divides by zero: unit cost is 0 when quantity is 0', () => {
    const c = computeLineItemCost({
      quantity: 0,
      materialUnitCost: 5,
      laborHours: 0,
      laborCostPerHour: 0,
      equipmentHours: 0,
      equipmentCostPerHour: 0,
      subcontractorCost: 250,
    });
    expect(c.totalCost).toBe(250);
    expect(c.unitCost).toBe(0);
  });

  it('treats a missing subcontractor cost as zero', () => {
    const c = computeLineItemCost({
      quantity: 1,
      materialUnitCost: 10,
      laborHours: 0,
      laborCostPerHour: 0,
      equipmentHours: 0,
      equipmentCostPerHour: 0,
      subcontractorCost: undefined as unknown as number,
    });
    expect(c.totalCost).toBe(10);
    expect(c.unitCost).toBe(10);
  });
});

describe('rollupLineItemCost', () => {
  it('sums known component totals and derives unit cost', () => {
    const r = rollupLineItemCost(
      { materialTotal: 300, laborTotal: 0, equipmentTotal: 0, subcontractorCost: 0 },
      150,
    );
    expect(r.totalCost).toBe(300);
    expect(r.unitCost).toBe(2);
  });

  it('guards quantity 0', () => {
    const r = rollupLineItemCost(
      { materialTotal: 99, laborTotal: 1, equipmentTotal: 0, subcontractorCost: 0 },
      0,
    );
    expect(r.totalCost).toBe(100);
    expect(r.unitCost).toBe(0);
  });
});
