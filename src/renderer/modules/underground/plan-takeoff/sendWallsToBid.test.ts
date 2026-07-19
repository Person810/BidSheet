import { describe, it, expect } from 'vitest';
import { measureForUnit, type WallGroup } from './sendWallsToBid';

const group: WallGroup = {
  heightFt: 4.5,
  thicknessIn: 8,
  faces: 1,
  memberSpacingIn: 16,
  materialId: null,
  assemblyId: null,
  totalLF: 100,
  surfaceSF: 450,
  volumeCY: 12.5,
  memberLF: 80,
  labels: [],
};

describe('measureForUnit', () => {
  it('picks the imperial measure matching the unit, defaulting to LF', () => {
    expect(measureForUnit('LF', group)).toBe(100);
    expect(measureForUnit('SF', group)).toBe(450);
    expect(measureForUnit('SY', group)).toBe(50);
    expect(measureForUnit('CY', group)).toBe(12.5);
    expect(measureForUnit('CYD', group)).toBe(12.5);
    expect(measureForUnit('EA', group)).toBe(100);
    expect(measureForUnit(null, group)).toBe(100);
    expect(measureForUnit(undefined, group)).toBe(100);
  });

  it('converts to the metric measure for metric-priced units (#97)', () => {
    // Unit-driven, not system-driven: an m²-priced material bills its m²
    // whatever the active setting is.
    expect(measureForUnit('m', group)).toBeCloseTo(30.48, 10);
    expect(measureForUnit('m²', group)).toBeCloseTo(450 * 0.3048 ** 2, 10);
    expect(measureForUnit('m³', group)).toBeCloseTo(12.5 * 27 * 0.3048 ** 3, 10);
  });
});
