import { describe, expect, it } from 'vitest';
import {
  calculateTrench,
  parsePipeSizeFromName,
  validateInput,
  type TrenchInput,
} from './trenchCalc';

const input = (overrides: Partial<TrenchInput> = {}): TrenchInput => ({
  pipeSizeIn: 8,
  pipeMaterial: 'PVC',
  startDepthFt: 4,
  gradePct: 0,
  runLengthLF: 100,
  trenchWidthFt: 3,
  benchWidthFt: 0,
  beddingDepthFt: 0.5,
  backfillType: 'Native',
  ...overrides,
});

describe('validateInput', () => {
  it('accepts a typical run', () => {
    expect(validateInput(input())).toEqual([]);
  });

  it('flags each out-of-range field', () => {
    const errors = validateInput(input({
      pipeSizeIn: 0,
      startDepthFt: 0,
      gradePct: -1,
      runLengthLF: 0,
      trenchWidthFt: 0,
      benchWidthFt: -1,
      beddingDepthFt: -0.5,
    }));
    const fields = errors.map((e) => e.field);
    expect(fields).toContain('pipeSizeIn');
    expect(fields).toContain('startDepthFt');
    expect(fields).toContain('gradePct');
    expect(fields).toContain('runLengthLF');
    expect(fields).toContain('trenchWidthFt');
    expect(fields).toContain('benchWidthFt');
    expect(fields).toContain('beddingDepthFt');
  });

  it('rejects a pipe as wide as the trench', () => {
    const errors = validateInput(input({ pipeSizeIn: 36, trenchWidthFt: 3 }));
    expect(errors.some((e) => e.field === 'trenchWidthFt' && /wider/.test(e.message))).toBe(true);
  });
});

describe('calculateTrench', () => {
  it('computes volumes for a flat run (hand-checked)', () => {
    // 12" pipe, 4 ft deep, flat, 100 LF, 3 ft trench + 1 ft bench each side
    const out = calculateTrench(input({
      pipeSizeIn: 12,
      startDepthFt: 4,
      gradePct: 0,
      runLengthLF: 100,
      trenchWidthFt: 3,
      benchWidthFt: 1,
      beddingDepthFt: 0.5,
    }));

    expect(out.pipeLF).toBeCloseTo(100);
    expect(out.endDepthFt).toBeCloseTo(4);
    expect(out.avgDepthFt).toBeCloseTo(4);
    // (3 + 2*1) ft wide * 4 ft deep * 100 LF = 2000 CF = 74.07 CY
    expect(out.excavationCY).toBeCloseTo(74.07, 2);
    // 3 * 0.5 * 100 = 150 CF = 5.56 CY
    expect(out.beddingCY).toBeCloseTo(5.56, 2);
    // backfill = 2000 - 150 - pi * 0.5^2 * 100 = 1771.46 CF = 65.61 CY
    expect(out.backfillCY).toBeCloseTo(65.61, 2);
    expect(out.tracerWireLF).toBe(100);
    expect(out.warningTapeLF).toBe(100);
  });

  it('slopes the run: end depth, average depth, and true pipe length follow the grade', () => {
    const out = calculateTrench(input({ startDepthFt: 4, gradePct: 2, runLengthLF: 100 }));
    expect(out.endDepthFt).toBeCloseTo(6); // 2 ft fall per 100 ft
    expect(out.avgDepthFt).toBeCloseTo(5);
    expect(out.pipeLF).toBeCloseTo(Math.sqrt(100 ** 2 + 2 ** 2), 2);
  });

  it('never returns negative backfill', () => {
    // Bedding spec deeper than the trench itself
    const out = calculateTrench(input({ startDepthFt: 0.1, beddingDepthFt: 5 }));
    expect(out.backfillCY).toBe(0);
  });
});

describe('parsePipeSizeFromName', () => {
  it('reads whole-inch sizes', () => {
    expect(parsePipeSizeFromName('8" PVC SDR-35')).toBe(8);
  });

  it('reads fractional sizes', () => {
    expect(parsePipeSizeFromName('3/4" Copper Type K')).toBe(0.75);
  });

  it('reads decimal sizes', () => {
    expect(parsePipeSizeFromName('1.5" HDPE')).toBe(1.5);
  });

  it('returns 0 when the name has no leading size', () => {
    expect(parsePipeSizeFromName('PVC SDR-35 8 inch')).toBe(0);
    expect(parsePipeSizeFromName('')).toBe(0);
  });
});
