import { describe, expect, it } from 'vitest';
import {
  CUBIC_FEET_PER_CUBIC_YARD,
  INCHES_PER_FOOT,
  SQUARE_FEET_PER_SQUARE_YARD,
  UNITS,
  cubicFeetToYards,
  defaultUnit,
  inchesToFeet,
  squareFeetToYards,
  unitOptions,
} from './units';

describe('dimensional conversions', () => {
  it('uses the standard imperial factors', () => {
    expect(INCHES_PER_FOOT).toBe(12);
    expect(SQUARE_FEET_PER_SQUARE_YARD).toBe(9);
    expect(CUBIC_FEET_PER_CUBIC_YARD).toBe(27);
  });

  it('converts inches to feet', () => {
    expect(inchesToFeet(12)).toBe(1);
    expect(inchesToFeet(6)).toBe(0.5);
    expect(inchesToFeet(0)).toBe(0);
  });

  it('converts square feet to square yards', () => {
    expect(squareFeetToYards(9)).toBe(1);
    expect(squareFeetToYards(90)).toBe(10);
  });

  it('converts cubic feet to cubic yards', () => {
    expect(cubicFeetToYards(27)).toBe(1);
    expect(cubicFeetToYards(54)).toBe(2);
  });
});

describe('system-scoped unit pickers (#97)', () => {
  const NEUTRAL = ['EA', 'LS', 'HR'];

  it('imperial mode offers exactly the classic UNITS list', () => {
    expect(unitOptions('imperial')).toEqual([...UNITS]);
  });

  it('metric mode offers metric + neutral units and no imperial-only ones', () => {
    const metric = unitOptions('metric');
    for (const u of ['m', 'm²', 'm³', 't', 'L', ...NEUTRAL]) expect(metric).toContain(u);
    for (const u of ['LF', 'CYD', 'SY', 'TON', 'VF', 'GAL', 'SF']) expect(metric).not.toContain(u);
  });

  it('neutral units appear in both systems', () => {
    for (const u of NEUTRAL) {
      expect(unitOptions('imperial')).toContain(u);
      expect(unitOptions('metric')).toContain(u);
    }
  });

  it('prepends an out-of-system current unit so existing rows keep rendering', () => {
    expect(unitOptions('metric', 'TON')[0]).toBe('TON');
    expect(unitOptions('imperial', 'm³')[0]).toBe('m³');
    // engine-emitted 'CY' is not in the picker list but must survive an edit
    expect(unitOptions('imperial', 'CY')[0]).toBe('CY');
  });

  it('does not duplicate an in-system current unit', () => {
    const opts = unitOptions('metric', 'm³');
    expect(opts.filter((u) => u === 'm³')).toHaveLength(1);
    expect(unitOptions('imperial', 'LF')).toEqual([...UNITS]);
  });

  it('defaults new length-shaped forms per system', () => {
    expect(defaultUnit('imperial')).toBe('LF');
    expect(defaultUnit('metric')).toBe('m');
  });
});
