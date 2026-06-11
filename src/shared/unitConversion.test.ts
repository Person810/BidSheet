import { describe, it, expect } from 'vitest';
import { effectiveMaterialUnitCost, isCubicYards } from './unitConversion';

describe('isCubicYards', () => {
  it('accepts CY and CYD in any case', () => {
    expect(isCubicYards('CY')).toBe(true);
    expect(isCubicYards('CYD')).toBe(true);
    expect(isCubicYards('cy')).toBe(true);
  });

  it('rejects other units and empty values', () => {
    expect(isCubicYards('TON')).toBe(false);
    expect(isCubicYards('LF')).toBe(false);
    expect(isCubicYards('')).toBe(false);
    expect(isCubicYards(null)).toBe(false);
    expect(isCubicYards(undefined)).toBe(false);
  });
});

describe('effectiveMaterialUnitCost', () => {
  it('uses the direct per-CY price for CY lines', () => {
    const stone = { unit: 'TON', default_unit_cost: 28, cost_per_cy: 39.2, tons_per_cy: 1.4 };
    expect(effectiveMaterialUnitCost(stone, 'CY')).toEqual({ cost: 39.2, converted: true });
    expect(effectiveMaterialUnitCost(stone, 'CYD')).toEqual({ cost: 39.2, converted: true });
  });

  it('falls back to density conversion when only density is set', () => {
    const stone = { unit: 'TON', default_unit_cost: 28, cost_per_cy: null, tons_per_cy: 1.4 };
    expect(effectiveMaterialUnitCost(stone, 'CY')).toEqual({ cost: 39.2, converted: true });
  });

  it('rounds density-derived prices to cents', () => {
    const mat = { unit: 'TON', default_unit_cost: 26.33, tons_per_cy: 1.35 };
    expect(effectiveMaterialUnitCost(mat, 'CY').cost).toBe(35.55);
  });

  it('returns the catalog price when the line is in the pricing unit', () => {
    const stone = { unit: 'TON', default_unit_cost: 28, cost_per_cy: 39.2, tons_per_cy: 1.4 };
    expect(effectiveMaterialUnitCost(stone, 'TON')).toEqual({ cost: 28, converted: false });
  });

  it('returns the catalog price unconverted when no CY price or density exists', () => {
    const bare = { unit: 'TON', default_unit_cost: 28 };
    expect(effectiveMaterialUnitCost(bare, 'CY')).toEqual({ cost: 28, converted: false });
    const zeros = { unit: 'TON', default_unit_cost: 28, cost_per_cy: 0, tons_per_cy: 0 };
    expect(effectiveMaterialUnitCost(zeros, 'CY')).toEqual({ cost: 28, converted: false });
  });

  it('never converts non-TON materials', () => {
    const concrete = { unit: 'CYD', default_unit_cost: 165, cost_per_cy: 99, tons_per_cy: 2 };
    expect(effectiveMaterialUnitCost(concrete, 'CY')).toEqual({ cost: 165, converted: false });
  });
});
