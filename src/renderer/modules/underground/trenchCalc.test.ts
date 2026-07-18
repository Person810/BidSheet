import { describe, expect, it } from 'vitest';
import {
  calculateTrench,
  depthZoneBreakdown,
  parsePipeSizeFromName,
  validateInput,
  NATIVE_BACKFILL_LABEL,
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
    // Tracer wire is taped to the pipe (follows slope); warning tape is
    // near-surface (horizontal)
    expect(out.tracerWireLF).toBeCloseTo(out.pipeLF, 2);
    expect(out.warningTapeLF).toBe(100);
  });

  it('never returns negative backfill', () => {
    // Bedding spec deeper than the trench itself
    const out = calculateTrench(input({ startDepthFt: 0.1, beddingDepthFt: 5 }));
    expect(out.backfillCY).toBe(0);
  });
});

describe('compaction/waste factor (issue #9)', () => {
  it('defaults to off: no compactionPct means unadjusted volumes', () => {
    const base = calculateTrench(input());
    const explicit = calculateTrench(input({ compactionPct: 0 }));
    expect(explicit).toEqual(base);
  });

  it('inflates bedding and imported backfill by the factor, leaving excavation alone', () => {
    const base = calculateTrench(input({ backfillType: '3/4" Crushed Stone' }));
    const out = calculateTrench(input({ backfillType: '3/4" Crushed Stone', compactionPct: 15 }));
    expect(out.beddingCY).toBeCloseTo(base.beddingCY * 1.15, 1);
    expect(out.backfillCY).toBeCloseTo(base.backfillCY * 1.15, 1);
    expect(out.excavationCY).toBeCloseTo(base.excavationCY, 2);
    expect(out.pipeLF).toBeCloseTo(base.pipeLF, 2);
  });

  it('never adjusts native backfill, but still adjusts bedding', () => {
    const base = calculateTrench(input({ backfillType: NATIVE_BACKFILL_LABEL }));
    const out = calculateTrench(input({ backfillType: NATIVE_BACKFILL_LABEL, compactionPct: 20 }));
    expect(out.backfillCY).toBeCloseTo(base.backfillCY, 2);
    expect(out.beddingCY).toBeCloseTo(base.beddingCY * 1.2, 1);
  });

  it('subtracts the neat-line (compacted) bedding volume from backfill, not the inflated one', () => {
    // 20% on bedding must not shrink the backfill volume: the trench space
    // occupied by bedding is the compacted volume.
    const base = calculateTrench(input({ backfillType: NATIVE_BACKFILL_LABEL }));
    const out = calculateTrench(input({ backfillType: NATIVE_BACKFILL_LABEL, compactionPct: 20 }));
    expect(out.backfillCY).toBeCloseTo(base.backfillCY, 2);
  });

  it('validates the range', () => {
    expect(validateInput(input({ compactionPct: -5 })).map((e) => e.field)).toContain('compactionPct');
    expect(validateInput(input({ compactionPct: 101 })).map((e) => e.field)).toContain('compactionPct');
    expect(validateInput(input({ compactionPct: 15 }))).toEqual([]);
    expect(validateInput(input({ compactionPct: 0 }))).toEqual([]);
  });
});

describe('depthZoneBreakdown', () => {
  it('puts a flat run entirely in the one band it falls in', () => {
    const zones = depthZoneBreakdown(input({ startDepthFt: 4, gradePct: 0, runLengthLF: 100 }));
    expect(zones).toHaveLength(1);
    expect(zones[0].label).toBe('0–5 ft');
    expect(zones[0].lf).toBeCloseTo(100);
    // 3' wide (no bench) * 4' deep * 100 LF / 27 = 44.44 CY
    expect(zones[0].excavationCY).toBeCloseTo(44.44, 2);
  });

  it('splits a sloped run across bands at the depth breaks', () => {
    // 4 ft start, 2% grade over 100 ft -> falls from 4 ft to 6 ft: crosses the 5 ft break at station 50.
    const zones = depthZoneBreakdown(input({ startDepthFt: 4, gradePct: 2, runLengthLF: 100 }));
    expect(zones.map((z) => z.label)).toEqual(['0–5 ft', '5–10 ft']);
    expect(zones[0].lf).toBeCloseTo(50);
    expect(zones[1].lf).toBeCloseTo(50);
  });

  it('LF across all bands sums to the run length and CY sums to total excavation', () => {
    const inp = input({ startDepthFt: 2, gradePct: 3, runLengthLF: 400, trenchWidthFt: 4, benchWidthFt: 1 });
    const zones = depthZoneBreakdown(inp);
    const totalLf = zones.reduce((sum, z) => sum + z.lf, 0);
    const totalCy = zones.reduce((sum, z) => sum + z.excavationCY, 0);
    expect(totalLf).toBeCloseTo(400, 1);
    expect(totalCy).toBeCloseTo(calculateTrench(inp).excavationCY, 0);
  });

  it('skips bands entirely above the run when the run starts deep', () => {
    // Starts at 12 ft, flat -- never touches the 0-5 or 5-10 ft bands.
    const zones = depthZoneBreakdown(input({ startDepthFt: 12, gradePct: 0, runLengthLF: 50 }));
    expect(zones).toHaveLength(1);
    expect(zones[0].label).toBe('10–15 ft');
  });

  it('reports an open-ended top band past the last break', () => {
    const zones = depthZoneBreakdown(input({ startDepthFt: 18, gradePct: 1, runLengthLF: 500 }));
    expect(zones[zones.length - 1].label).toBe('20+ ft');
  });

  it('returns nothing for a degenerate run', () => {
    expect(depthZoneBreakdown(input({ runLengthLF: 0 }))).toEqual([]);
    expect(depthZoneBreakdown(input({ trenchWidthFt: 0 }))).toEqual([]);
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

  it('reads sizes that are not at the start of the name', () => {
    expect(parsePipeSizeFromName('PVC 8"')).toBe(8);
    expect(parsePipeSizeFromName('C-900 12" PVC')).toBe(12);
  });

  it('returns 0 when the name has no inch-marked size', () => {
    expect(parsePipeSizeFromName('PVC SDR-35 8 inch')).toBe(0);
    expect(parsePipeSizeFromName('')).toBe(0);
  });
});
