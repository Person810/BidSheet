import { describe, it, expect } from 'vitest';
import { effectiveMaterialUnitCost, isCubicMeters, isCubicYards, isMassUnit } from './unitConversion';

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

  it('never converts non-mass materials', () => {
    const concrete = { unit: 'CYD', default_unit_cost: 165, cost_per_cy: 99, tons_per_cy: 2 };
    expect(effectiveMaterialUnitCost(concrete, 'CY')).toEqual({ cost: 165, converted: false });
  });
});

describe('isCubicMeters / isMassUnit', () => {
  it('accepts m³ and M3 spellings', () => {
    expect(isCubicMeters('m³')).toBe(true);
    expect(isCubicMeters('M3')).toBe(true);
    expect(isCubicMeters('CY')).toBe(false);
    expect(isCubicMeters(null)).toBe(false);
  });

  it('recognizes TON and t as mass units', () => {
    expect(isMassUnit('TON')).toBe(true);
    expect(isMassUnit('t')).toBe(true);
    expect(isMassUnit('CY')).toBe(false);
    expect(isMassUnit(undefined)).toBe(false);
  });
});

describe('effectiveMaterialUnitCost — metric tonne materials', () => {
  // For a `t` material the second-price columns are metric:
  // cost_per_cy = $/m³, tons_per_cy = t/m³
  const gravel = { unit: 't', default_unit_cost: 30, cost_per_cy: 51, tons_per_cy: 1.7 };

  it('uses the direct per-m³ price for m³ lines', () => {
    expect(effectiveMaterialUnitCost(gravel, 'm³')).toEqual({ cost: 51, converted: true });
  });

  it('falls back to density (t per m³) when only density is set', () => {
    const densityOnly = { unit: 't', default_unit_cost: 30, cost_per_cy: null, tons_per_cy: 1.7 };
    expect(effectiveMaterialUnitCost(densityOnly, 'm³')).toEqual({ cost: 51, converted: true });
  });

  it('prices a CY line from a tonne material via exact m³→CY conversion', () => {
    // $51/m³ × 0.764554857984 m³/CY = $38.99/CY
    expect(effectiveMaterialUnitCost(gravel, 'CY')).toEqual({ cost: 38.99, converted: true });
  });

  it('prices an m³ line from a TON material via exact CY→m³ conversion', () => {
    const stone = { unit: 'TON', default_unit_cost: 28, cost_per_cy: 39.2, tons_per_cy: 1.4 };
    // $39.20/CY ÷ 0.764554857984 m³/CY = $51.27/m³
    expect(effectiveMaterialUnitCost(stone, 'm³')).toEqual({ cost: 51.27, converted: true });
  });

  it('returns the catalog price when the line is in the pricing unit', () => {
    expect(effectiveMaterialUnitCost(gravel, 't')).toEqual({ cost: 30, converted: false });
  });

  it('returns the catalog price unconverted when no volume price or density exists', () => {
    const bare = { unit: 't', default_unit_cost: 30 };
    expect(effectiveMaterialUnitCost(bare, 'm³')).toEqual({ cost: 30, converted: false });
  });
});
