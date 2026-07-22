import { describe, it, expect } from 'vitest';
import {
  calculateEarthwork, validateEarthwork, type EarthworkInput, type ProposedRegion,
} from './earthworkCalc';
import type { Pt3 } from './surfaceModel';

const square = (size: number) => [
  { x: 0, y: 0 }, { x: size, y: 0 }, { x: size, y: size }, { x: 0, y: size },
];

describe('calculateEarthwork', () => {
  it('cut_depth: volume is area x depth, no surface needed', () => {
    const region: ProposedRegion = {
      id: 1, label: 'Pad', polygon: square(100), mode: 'cut_depth', value: 2,
    };
    const out = calculateEarthwork({ regions: [region] });
    // 100 x 100 x 2 / 27
    expect(out.totalCutCY).toBeCloseTo(740.74, 1);
    expect(out.totalFillCY).toBe(0);
    expect(out.regions[0].uncoveredCells).toBe(0);
  });

  it('fill_depth: routes volume to fill', () => {
    const region: ProposedRegion = {
      id: 1, label: 'Berm', polygon: square(90), mode: 'fill_depth', value: 1.5,
    };
    const out = calculateEarthwork({ regions: [region] });
    expect(out.totalFillCY).toBeCloseTo((90 * 90 * 1.5) / 27, 1);
    expect(out.totalCutCY).toBe(0);
  });

  it('finished_elev: integrates existing-minus-finished against the TIN', () => {
    const existing: Pt3[] = [
      { x: 0, y: 0, z: 100 }, { x: 100, y: 0, z: 100 },
      { x: 100, y: 100, z: 100 }, { x: 0, y: 100, z: 100 }, { x: 50, y: 50, z: 100 },
    ];
    const region: ProposedRegion = {
      id: 1, label: 'Cut to 98', polygon: square(100), mode: 'finished_elev', value: 98,
    };
    const out = calculateEarthwork({ regions: [region], existingSurface: existing, gridSpacingFt: 10 });
    // 2 ft of cut across the full 100x100 footprint
    expect(out.totalCutCY).toBeCloseTo(740.74, 0);
    expect(out.totalFillCY).toBe(0);
    expect(out.regions[0].uncoveredCells).toBe(0);
  });

  it('finished_elev: sloped existing gives mixed cut and fill', () => {
    // Surface rises from z=96 at x=0 to z=104 at x=100 (crosses finished=100 at midspan)
    const existing: Pt3[] = [
      { x: 0, y: 0, z: 96 }, { x: 0, y: 100, z: 96 },
      { x: 100, y: 0, z: 104 }, { x: 100, y: 100, z: 104 },
    ];
    const region: ProposedRegion = {
      id: 1, label: 'Balance', polygon: square(100), mode: 'finished_elev', value: 100,
    };
    const out = calculateEarthwork({ regions: [region], existingSurface: existing, gridSpacingFt: 5 });
    expect(out.totalCutCY).toBeGreaterThan(0);
    expect(out.totalFillCY).toBeGreaterThan(0);
    // Symmetric plane about the finished elevation -> net near zero
    expect(Math.abs(out.netCY)).toBeLessThan(1);
  });

  it('finished_elev: a pad small relative to the grid samples near its true area', () => {
    // Flat existing surface at z=100 well overhanging the pad
    const existing: Pt3[] = [
      { x: -10, y: -10, z: 100 }, { x: 22, y: -10, z: 100 },
      { x: 22, y: 22, z: 100 }, { x: -10, y: 22, z: 100 },
    ];
    const region: ProposedRegion = {
      id: 1, label: 'Small pad', polygon: square(12), mode: 'finished_elev', value: 98,
    };
    // Default 10-ft grid: center-only sampling read this 144 SF pad as one
    // full 100 SF cell. The effective sampled area must land near 144 SF.
    const out = calculateEarthwork({ regions: [region], existingSurface: existing });
    const sampledSF = (out.totalCutCY * 27) / 2;
    expect(sampledSF).toBeGreaterThan(140);
    expect(sampledSF).toBeLessThan(148);
    expect(out.regions[0].uncoveredCells).toBe(0);
  });

  it('finished_elev: a narrow strip between grid rows is not missed', () => {
    const existing: Pt3[] = [
      { x: -10, y: -10, z: 100 }, { x: 110, y: -10, z: 100 },
      { x: 110, y: 40, z: 100 }, { x: -10, y: 40, z: 100 },
    ];
    // 8-ft strip whose interior never touches a 10-ft cell center row
    const region: ProposedRegion = {
      id: 1, label: 'Strip', mode: 'finished_elev', value: 99,
      polygon: [{ x: 0, y: 11 }, { x: 100, y: 11 }, { x: 100, y: 19 }, { x: 0, y: 19 }],
    };
    const out = calculateEarthwork({ regions: [region], existingSurface: existing });
    // 100 x 8 x 1 / 27 = 29.6 CY (was 0 with center-only sampling)
    expect(out.totalCutCY).toBeGreaterThan(28);
    expect(out.totalCutCY).toBeLessThan(31.5);
  });

  it('flags a missing surface instead of silently returning zero', () => {
    const region: ProposedRegion = {
      id: 1, label: 'Oops', polygon: square(50), mode: 'finished_elev', value: 95,
    };
    const out = calculateEarthwork({ regions: [region] });
    expect(out.regions[0].uncoveredCells).toBe(-1);
    expect(out.totalCutCY).toBe(0);
  });

  it('swell and shrink drive export/import; zero factors collapse to net', () => {
    const cut: ProposedRegion = { id: 1, label: 'Cut', polygon: square(100), mode: 'cut_depth', value: 3 };
    const fill: ProposedRegion = { id: 2, label: 'Fill', polygon: square(50), mode: 'fill_depth', value: 1 };
    const base = calculateEarthwork({ regions: [cut, fill] });
    expect(base.exportCY).toBeCloseTo(base.netCY, 1); // net cut, no factors
    expect(base.importCY).toBe(0);

    const withFactors = calculateEarthwork({ regions: [cut, fill], swellPct: 0.25, shrinkPct: 0.15 });
    expect(withFactors.exportCY).toBeGreaterThan(base.exportCY); // loose haul is larger
  });
});

describe('validateEarthwork', () => {
  it('requires a surface for finished_elev regions', () => {
    const errs = validateEarthwork({
      regions: [{ id: 1, label: 'A', polygon: square(10), mode: 'finished_elev', value: 95 }],
    });
    expect(errs.some((e) => e.field === 'existingSurface')).toBe(true);
  });

  it('rejects non-positive depths and degenerate polygons', () => {
    const errs = validateEarthwork({
      regions: [
        { id: 1, label: 'BadDepth', polygon: square(10), mode: 'cut_depth', value: 0 },
        { id: 2, label: 'BadPoly', polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }], mode: 'fill_depth', value: 2 },
      ],
    });
    expect(errs.length).toBeGreaterThanOrEqual(2);
  });
});
