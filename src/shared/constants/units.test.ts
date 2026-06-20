import { describe, expect, it } from 'vitest';
import {
  CUBIC_FEET_PER_CUBIC_YARD,
  INCHES_PER_FOOT,
  SQUARE_FEET_PER_SQUARE_YARD,
  cubicFeetToYards,
  inchesToFeet,
  squareFeetToYards,
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
