import { describe, expect, it } from 'vitest';
import { buildRunProfile, niceTickStep, segmentGrades } from './profileModel';
import type { TakeoffRun } from './types';

const baseRun = (overrides: Partial<TakeoffRun> = {}): TakeoffRun => ({
  id: 1,
  label: 'Test Run',
  utilityType: 'sanitary',
  pipeSizeIn: 8,
  pipeMaterial: 'PVC',
  pipeMaterialId: null,
  startDepthFt: 4,
  gradePct: 2,
  trenchWidthFt: 3,
  benchWidthFt: 0,
  beddingType: '#57 Stone',
  beddingDepthFt: 0.5,
  beddingMaterialId: null,
  backfillType: 'Native',
  backfillMaterialId: null,
  color: '#4CAF50',
  pdfPage: 1,
  // 100 ft straight run at 10 px/ft
  points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }],
  ...overrides,
});

describe('buildRunProfile — depth mode (no surveyed elevations)', () => {
  it('falls from start depth at the design grade under a flat datum', () => {
    const p = buildRunProfile(baseRun(), 10)!;
    expect(p.mode).toBe('depth');
    expect(p.groundAssumed).toBe(true);
    expect(p.totalLengthFt).toBeCloseTo(100);
    expect(p.stations[0].ground).toBe(0);
    expect(p.stations[0].invert).toBeCloseTo(-4);
    // 2% over 100 ft = 2 ft additional depth
    expect(p.stations[1].invert).toBeCloseTo(-6);
  });

  it('computes the plot range from trench bottom to ground plus pipe', () => {
    const p = buildRunProfile(baseRun(), 10)!;
    expect(p.minElev).toBeCloseTo(-6.5); // deepest invert minus bedding
    expect(p.maxElev).toBeCloseTo(0); // flat datum
  });

  it('returns null for unmeasurable runs', () => {
    expect(buildRunProfile(baseRun({ points: [{ x: 0, y: 0 }] }), 10)).toBeNull();
    expect(buildRunProfile(baseRun(), 0)).toBeNull();
  });
});

describe('buildRunProfile — elevation mode (surveyed inverts)', () => {
  const surveyed = baseRun({
    points: [
      { x: 0, y: 0, invertElev: 96, rimElev: 102, structureType: 'MH' },
      { x: 500, y: 0 }, // intermediate bend, nothing surveyed
      { x: 1000, y: 0, invertElev: 94, rimElev: 101, structureType: 'MH' },
    ],
  });

  it('anchors on known inverts and interpolates between them', () => {
    const p = buildRunProfile(surveyed, 10)!;
    expect(p.mode).toBe('elevation');
    expect(p.groundAssumed).toBe(false);
    expect(p.stations[0].invert).toBe(96);
    expect(p.stations[2].invert).toBe(94);
    // Midpoint interpolates linearly between the two manholes
    expect(p.stations[1].invert).toBeCloseTo(95);
    expect(p.stations[1].ground).toBeCloseTo(101.5);
  });

  it('reports actual segment grades from resolved inverts', () => {
    const p = buildRunProfile(surveyed, 10)!;
    const grades = segmentGrades(p);
    // 2 ft fall over 100 ft, evenly split: 2% per segment
    expect(grades[0]).toBeCloseTo(2);
    expect(grades[1]).toBeCloseTo(2);
  });

  it('extrapolates past a single known invert at the design grade', () => {
    const oneAnchor = baseRun({
      gradePct: 1,
      points: [
        { x: 0, y: 0, invertElev: 90 },
        { x: 1000, y: 0 },
      ],
    });
    const p = buildRunProfile(oneAnchor, 10)!;
    expect(p.stations[1].invert).toBeCloseTo(89); // 1% fall over 100 ft
    // No rims anywhere: ground assumed at first invert + start depth
    expect(p.groundAssumed).toBe(true);
    expect(p.stations[0].ground).toBeCloseTo(94);
  });

  it('keeps the ground flat past known rims instead of following pipe grade', () => {
    const p = buildRunProfile(baseRun({
      points: [
        { x: 0, y: 0, invertElev: 96, rimElev: 102 },
        { x: 1000, y: 0, invertElev: 94 }, // no rim here
      ],
    }), 10)!;
    expect(p.stations[1].ground).toBeCloseTo(102); // flat extrapolation
  });
});

describe('niceTickStep', () => {
  it('keeps tick counts in a readable range', () => {
    expect(niceTickStep(100)).toBe(20);
    expect(niceTickStep(8)).toBe(1);
    expect(niceTickStep(450)).toBe(100);
  });
});
