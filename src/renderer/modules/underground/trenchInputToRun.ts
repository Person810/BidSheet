import type { TakeoffRun } from './plan-takeoff/types';
import { UTILITY_COLORS } from './plan-takeoff/types';
import type { TrenchInput } from './trenchCalc';

/**
 * Arbitrary but fixed plan-view scale used only to synthesize a straight-line
 * run for the 3D preview below. It cancels out in trench3dModel's math (world
 * feet = px / scalePxPerFt), so any positive value works.
 */
export const TRENCH_PREVIEW_SCALE_PX_PER_FT = 10;

/**
 * Turns a standalone trench-calculator input (no plan geometry) into a
 * two-point straight TakeoffRun so it can be handed to Trench3DView, the
 * same 3D renderer used for plan-takeoff runs. With no invert/rim elevations
 * on either vertex, profileModel falls back to its flat-datum 'depth' mode —
 * ground at 0, invert falling from -startDepthFt at the entered grade —
 * which is exactly what "Starting Depth" + "Grade" mean in this calculator.
 */
export function trenchInputToTakeoffRun(input: TrenchInput, label = ''): TakeoffRun {
  const lengthPx = Math.max(input.runLengthLF, 1) * TRENCH_PREVIEW_SCALE_PX_PER_FT;
  return {
    id: -1,
    label,
    utilityType: 'sanitary',
    pipeSizeIn: input.pipeSizeIn,
    pipeMaterial: input.pipeMaterial,
    pipeMaterialId: null,
    startDepthFt: input.startDepthFt,
    gradePct: input.gradePct,
    trenchWidthFt: input.trenchWidthFt,
    benchWidthFt: input.benchWidthFt,
    beddingType: '',
    beddingDepthFt: input.beddingDepthFt,
    beddingMaterialId: null,
    backfillType: input.backfillType,
    backfillMaterialId: null,
    color: UTILITY_COLORS.sanitary,
    pdfPage: 1,
    points: [
      { x: 0, y: 0 },
      { x: lengthPx, y: 0 },
    ],
  };
}
