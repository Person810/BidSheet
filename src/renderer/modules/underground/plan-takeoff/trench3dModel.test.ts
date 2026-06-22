import { describe, expect, it } from 'vitest';
import { buildRunGeometry, prismCorners, PRISM_INDICES } from './trench3dModel';
import type { TakeoffRun } from './types';

const baseRun = (overrides: Partial<TakeoffRun> = {}): TakeoffRun => ({
  id: 1,
  label: 'Test Run',
  utilityType: 'sanitary',
  pipeSizeIn: 12,
  pipeMaterial: 'PVC',
  pipeMaterialId: null,
  startDepthFt: 4,
  gradePct: 2,
  trenchWidthFt: 3,
  benchWidthFt: 1,
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

describe('buildRunGeometry', () => {
  it('returns null for a degenerate run', () => {
    expect(buildRunGeometry(baseRun({ points: [{ x: 0, y: 0 }] }), 10)).toBeNull();
    expect(buildRunGeometry(baseRun(), 0)).toBeNull();
  });

  it('builds one segment per polyline edge with elevations from the profile', () => {
    const m = buildRunGeometry(baseRun(), 10)!;
    expect(m.segments).toHaveLength(1);
    const s = m.segments[0];
    // Depth mode: ground at datum 0, invert falls from -4 to -6 over 100 ft.
    expect(s.groundA).toBeCloseTo(0);
    expect(s.invertA).toBeCloseTo(-4);
    expect(s.invertB).toBeCloseTo(-6);
    // Trench bottom = invert - bedding depth
    expect(s.bottomA).toBeCloseTo(-4.5);
    expect(s.bottomB).toBeCloseTo(-6.5);
    expect(m.mode).toBe('depth');
  });

  it('reports the full benched dig width and the nominal trench width', () => {
    const m = buildRunGeometry(baseRun(), 10)!;
    expect(m.trenchWidthFt).toBe(3);
    expect(m.totalWidthFt).toBe(5); // 3 + 2 * 1
  });

  it('places the pipe centerline a radius above the invert', () => {
    const m = buildRunGeometry(baseRun(), 10)!;
    // 12" pipe => 1 ft dia => 0.5 ft radius above the -4 invert at the start.
    expect(m.pipeCenterline[0].y).toBeCloseTo(-3.5);
    expect(m.pipeCenterline).toHaveLength(2);
  });

  it('centers horizontal coordinates on the polyline centroid', () => {
    const m = buildRunGeometry(baseRun(), 10)!;
    // centroid x = 500px -> 50ft; endpoints land at -50 and +50 ft.
    expect(m.segments[0].ax).toBeCloseTo(-50);
    expect(m.segments[0].bx).toBeCloseTo(50);
  });

  it('collects surveyed structures as shafts', () => {
    const m = buildRunGeometry(baseRun({
      points: [
        { x: 0, y: 0, invertElev: 100, rimElev: 104, structureType: 'MH' },
        { x: 1000, y: 0 },
      ],
    }), 10)!;
    expect(m.mode).toBe('elevation');
    expect(m.structures).toHaveLength(1);
    expect(m.structures[0].type).toBe('MH');
    expect(m.structures[0].ground).toBeCloseTo(104);
    expect(m.structures[0].invert).toBeCloseTo(100);
  });
});

describe('prismCorners', () => {
  it('offsets corners perpendicular to a run heading +x by the half width', () => {
    const seg = {
      ax: 0, az: 0, bx: 10, bz: 0,
      groundA: 0, groundB: 0, invertA: -4, invertB: -4, bottomA: -4.5, bottomB: -4.5,
    };
    const c = prismCorners(seg, 2, seg.groundA, seg.groundB, seg.bottomA, seg.bottomB);
    expect(c).toHaveLength(24); // 8 corners * xyz
    // First bottom corner: x stays 0, z offset perpendicular by the half width, y = bottom
    expect(c[0]).toBeCloseTo(0);    // x
    expect(c[1]).toBeCloseTo(-4.5); // y (bottom)
    expect(Math.abs(c[2])).toBeCloseTo(2); // z offset by half width
    // Indices index into 8 corners only
    expect(Math.max(...PRISM_INDICES)).toBe(7);
    expect(PRISM_INDICES).toHaveLength(36); // 12 triangles
  });
});
