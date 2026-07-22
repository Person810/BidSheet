import { describe, it, expect } from 'vitest';
import { areaMeasureForUnit, type AreaGroup } from './sendAreasToBid';

const group: AreaGroup = {
  areaType: 'asphalt',
  depthFt: 0.5,
  materialId: null,
  assemblyId: null,
  totalSF: 900,
  totalSY: 100,
  totalCY: 16.7,
  labels: [],
};

describe('areaMeasureForUnit', () => {
  it('picks the imperial measure matching the unit, defaulting to SY', () => {
    expect(areaMeasureForUnit('SY', group)).toBe(100);
    // A per-SF assembly gets the SF quantity, not the SY one (9x underbill)
    expect(areaMeasureForUnit('SF', group)).toBe(900);
    expect(areaMeasureForUnit('CY', group)).toBe(16.7);
    expect(areaMeasureForUnit('CYD', group)).toBe(16.7);
    expect(areaMeasureForUnit('TON', group)).toBe(100);
    expect(areaMeasureForUnit(null, group)).toBe(100);
    expect(areaMeasureForUnit(undefined, group)).toBe(100);
  });

  it('converts to the metric measure for metric-priced units', () => {
    // Unit-driven, not system-driven: an m²-priced assembly bills its m²
    // whatever the active setting is.
    expect(areaMeasureForUnit('m²', group)).toBeCloseTo(900 * 0.3048 ** 2, 6);
    expect(areaMeasureForUnit('m³', group)).toBeCloseTo(16.7 * 27 * 0.3048 ** 3, 6);
  });
});
