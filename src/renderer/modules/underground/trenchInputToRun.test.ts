import { describe, expect, it } from 'vitest';
import { trenchInputToTakeoffRun, TRENCH_PREVIEW_SCALE_PX_PER_FT } from './trenchInputToRun';
import { buildRunGeometry } from './plan-takeoff/trench3dModel';
import type { TrenchInput } from './trenchCalc';

const baseInput: TrenchInput = {
  pipeSizeIn: 8,
  pipeMaterial: 'PVC SDR-35',
  startDepthFt: 4,
  gradePct: 2,
  runLengthLF: 100,
  trenchWidthFt: 3,
  benchWidthFt: 1,
  beddingDepthFt: 0.5,
  backfillType: 'Native Material',
};

describe('trenchInputToTakeoffRun', () => {
  it('produces a straight two-point run carrying the trench parameters', () => {
    const run = trenchInputToTakeoffRun(baseInput, 'MH-1 to MH-2');
    expect(run.label).toBe('MH-1 to MH-2');
    expect(run.points).toHaveLength(2);
    expect(run.points[0]).toEqual({ x: 0, y: 0 });
    expect(run.points[1].x).toBeCloseTo(baseInput.runLengthLF * TRENCH_PREVIEW_SCALE_PX_PER_FT);
    expect(run.pipeSizeIn).toBe(8);
    expect(run.trenchWidthFt).toBe(3);
    expect(run.benchWidthFt).toBe(1);
    expect(run.beddingDepthFt).toBe(0.5);
    // No invert/rim elevations, so buildRunProfile falls back to flat-datum depth mode.
    expect(run.points[0].invertElev).toBeUndefined();
    expect(run.points[0].rimElev).toBeUndefined();
  });

  it('feeds buildRunGeometry a model matching the entered start depth and grade', () => {
    const run = trenchInputToTakeoffRun(baseInput);
    const model = buildRunGeometry(run, TRENCH_PREVIEW_SCALE_PX_PER_FT)!;
    expect(model).not.toBeNull();
    expect(model.mode).toBe('depth');
    expect(model.totalLengthFt).toBeCloseTo(100);
    expect(model.segments[0].groundA).toBeCloseTo(0);
    expect(model.segments[0].invertA).toBeCloseTo(-4);
    // 2% grade over 100 ft => 2 ft fall
    expect(model.segments[0].invertB).toBeCloseTo(-6);
    expect(model.totalWidthFt).toBe(5); // trench 3' + 1' bench each side
  });

  it('guards against a zero-length run producing degenerate geometry', () => {
    const run = trenchInputToTakeoffRun({ ...baseInput, runLengthLF: 0 });
    expect(run.points[1].x).toBeGreaterThan(0);
    expect(buildRunGeometry(run, TRENCH_PREVIEW_SCALE_PX_PER_FT)).not.toBeNull();
  });

  it('T004: returns a non-blocking warning (not hard error) when combined pipe width exceeds nominal trench width for stacked conduit duct banks', () => {
    // 4 x 6" (0.5 ft) conduits = 2.0 ft total width in a 1.5 ft trench (stacked vertically)
    const stackedDuctBankInput: TrenchInput = {
      ...baseInput,
      pipeSizeIn: 6,
      trenchWidthFt: 1.5,
      additionalPipes: [
        { pipeMaterial: 'PVC', pipeSizeIn: 6 },
        { pipeMaterial: 'PVC', pipeSizeIn: 6 },
        { pipeMaterial: 'PVC', pipeSizeIn: 6 },
      ],
    };

    const run = trenchInputToTakeoffRun(stackedDuctBankInput, 'Duct Bank Run');
    expect(run).toBeDefined();
    expect(run.pipeSizeIn).toBe(6);
  });
});
