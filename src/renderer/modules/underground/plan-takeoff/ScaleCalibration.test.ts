import { describe, it, expect } from 'vitest';
import { formatScale } from './ScaleCalibration';

describe('formatScale', () => {
  it('formats engineering scales imperial (1″ = X′)', () => {
    expect(formatScale(72 / 50)).toBe('1″ = 50′');
    expect(formatScale(72 / 20, 'imperial')).toBe('1″ = 20′');
    expect(formatScale(0)).toBe('No scale');
  });

  it('formats ratio scales metric (1:R) from the same canonical px/ft', () => {
    // A 1:R drawing has 864/R px per real foot (72 pt/in × 12 in/ft)
    expect(formatScale(864 / 500, 'metric')).toBe('1:500');
    expect(formatScale(864 / 100, 'metric')).toBe('1:100');
    // engineering 1" = 50' is the ratio 1:600 — same drawing, both spellings
    expect(formatScale(72 / 50, 'metric')).toBe('1:600');
    expect(formatScale(0, 'metric')).toBe('No scale');
  });
});
