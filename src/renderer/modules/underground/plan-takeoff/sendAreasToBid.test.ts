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
  it('picks the imperial measure matching the unit', () => {
    expect(areaMeasureForUnit('SY', group)).toBe(100);
    // A per-SF assembly gets the SF quantity, not the SY one (9x underbill)
    expect(areaMeasureForUnit('SF', group)).toBe(900);
    expect(areaMeasureForUnit('CY', group)).toBe(16.7);
    expect(areaMeasureForUnit('CYD', group)).toBe(16.7);
  });

  it('treats a blank unit as this flow\'s own billing unit', () => {
    expect(areaMeasureForUnit('', group)).toBe(100);
    expect(areaMeasureForUnit(null, group)).toBe(100);
    expect(areaMeasureForUnit(undefined, group)).toBe(100);
  });

  it('returns null for a unit with no area measure, rather than guessing SY', () => {
    // This is the 12x asphalt overbill: 900 SF of 2" patch is ~8.3 tons, and
    // a per-TON assembly used to be billed the square-YARD figure — 100 — as
    // tons, along with the crew and paver hours scaled off it.
    expect(areaMeasureForUnit('TON', group)).toBeNull();
    expect(areaMeasureForUnit('t', group)).toBeNull();
    expect(areaMeasureForUnit('EA', group)).toBeNull();
    expect(areaMeasureForUnit('LS', group)).toBeNull();
    expect(areaMeasureForUnit('LF', group)).toBeNull();
    expect(areaMeasureForUnit('HR', group)).toBeNull();
  });

  it('converts to the metric measure for metric-priced units', () => {
    // Unit-driven, not system-driven: an m²-priced assembly bills its m²
    // whatever the active setting is.
    expect(areaMeasureForUnit('m²', group)).toBeCloseTo(900 * 0.3048 ** 2, 6);
    expect(areaMeasureForUnit('m³', group)).toBeCloseTo(16.7 * 27 * 0.3048 ** 3, 6);
  });
});
