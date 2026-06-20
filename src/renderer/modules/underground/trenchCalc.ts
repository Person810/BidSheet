/**
 * Trench Profiler calculation engine.
 *
 * Pure functions -- no React, no side effects.
 * Reused by the standalone TrenchProfiler component now
 * and by the plan takeoff viewer later.
 */

import type { CalcBreakdown } from '../../../shared/calcExplain';
import { fmtNum } from '../../../shared/calcExplain';
import { cubicFeetToYards, inchesToFeet } from '../../../shared/constants/units';

// ---- Input / Output types --------------------------------------------------

export interface TrenchInput {
  pipeSizeIn: number;         // inches
  pipeMaterial: string;
  startDepthFt: number;       // invert depth at start, feet
  gradePct: number;           // e.g. 2.0 = 2 ft fall per 100 ft
  runLengthLF: number;        // horizontal run, LF
  trenchWidthFt: number;
  benchWidthFt: number;       // each side (0 = no bench)
  beddingDepthFt: number;     // bedding layer depth, feet
  backfillType: string;
}

export interface TrenchOutput {
  pipeLF: number;             // true pipe length
  endDepthFt: number;
  avgDepthFt: number;
  excavationCY: number;
  beddingCY: number;
  backfillCY: number;
  tracerWireLF: number;
  warningTapeLF: number;
}

export interface ValidationError {
  field: string;
  message: string;
}

// ---- Validation ------------------------------------------------------------

export function validateInput(input: TrenchInput): ValidationError[] {
  const errors: ValidationError[] = [];

  if (input.pipeSizeIn <= 0)
    errors.push({ field: 'pipeSizeIn', message: 'Pipe size must be > 0' });
  if (input.startDepthFt <= 0)
    errors.push({ field: 'startDepthFt', message: 'Starting depth must be > 0' });
  // Convention: enter the run from its upstream (shallow) end so the pipe
  // always falls downstream. A rising run is the same trench measured from
  // the other end.
  if (input.gradePct < 0)
    errors.push({ field: 'gradePct', message: 'Grade cannot be negative — measure from the upstream (shallow) end' });
  if (input.runLengthLF <= 0)
    errors.push({ field: 'runLengthLF', message: 'Run length must be > 0' });
  if (input.trenchWidthFt <= 0)
    errors.push({ field: 'trenchWidthFt', message: 'Trench width must be > 0' });
  if (input.benchWidthFt < 0)
    errors.push({ field: 'benchWidthFt', message: 'Bench width cannot be negative' });

  if (input.beddingDepthFt < 0)
    errors.push({ field: 'beddingDepthFt', message: 'Bedding depth cannot be negative' });

  const pipeDiameterFt = inchesToFeet(input.pipeSizeIn);
  if (pipeDiameterFt >= input.trenchWidthFt)
    errors.push({ field: 'trenchWidthFt', message: 'Trench must be wider than pipe' });

  return errors;
}

// ---- Calculation -----------------------------------------------------------

export function calculateTrench(input: TrenchInput): TrenchOutput {
  const {
    pipeSizeIn, startDepthFt, gradePct, runLengthLF,
    trenchWidthFt, benchWidthFt, beddingDepthFt,
  } = input;

  // Fall over the run
  const fallFt = (gradePct / 100) * runLengthLF;

  // True pipe length (hypotenuse of horizontal run and fall)
  const pipeLF = Math.sqrt(runLengthLF ** 2 + fallFt ** 2);

  // End depth = start + fall (pipe slopes away from starting point)
  const endDepthFt = startDepthFt + fallFt;
  const avgDepthFt = (startDepthFt + endDepthFt) / 2;

  // Total trench width including benches on each side
  const totalWidthFt = trenchWidthFt + benchWidthFt * 2;

  // Excavation volume (average-end-area)
  const excavationCF = totalWidthFt * avgDepthFt * runLengthLF;
  const excavationCY = cubicFeetToYards(excavationCF);

  // Bedding zone: full trench width x bedding depth x run length
  const beddingCF = trenchWidthFt * beddingDepthFt * runLengthLF;
  const beddingCY = cubicFeetToYards(beddingCF);

  // Pipe volume (cylinder) -- subtract from backfill
  const pipeRadiusFt = inchesToFeet(pipeSizeIn) / 2;
  const pipeCF = Math.PI * pipeRadiusFt ** 2 * pipeLF;

  // Backfill = excavation - bedding - pipe. Subtracting the full cylinder
  // assumes the pipe sits entirely above the bedding zone (bedding to
  // invert). For bedding-to-springline specs this slightly understates
  // backfill -- conservative, and within takeoff tolerance.
  const backfillCF = Math.max(excavationCF - beddingCF - pipeCF, 0);
  const backfillCY = cubicFeetToYards(backfillCF);

  // Tracer wire is taped to the pipe, so it follows the pipe slope; warning
  // tape is buried near-surface and runs the horizontal length.
  const tracerWireLF = pipeLF;
  const warningTapeLF = runLengthLF;

  return {
    pipeLF: round2(pipeLF),
    endDepthFt: round2(endDepthFt),
    avgDepthFt: round2(avgDepthFt),
    excavationCY: round2(excavationCY),
    beddingCY: round2(beddingCY),
    backfillCY: round2(backfillCY),
    tracerWireLF: round2(tracerWireLF),
    warningTapeLF: round2(warningTapeLF),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * "Show the math" for the trench takeoff (§5). Re-derives the substituted
 * arithmetic for the volumes from the same inputs, so the numbers in the
 * summary table are never a black box.
 */
export function explainTrench(input: TrenchInput, output: TrenchOutput): {
  avgDepth: CalcBreakdown;
  excavation: CalcBreakdown;
  bedding: CalcBreakdown;
  backfill: CalcBreakdown;
} {
  const ft = (n: number) => `${fmtNum(n, 2)} ft`;
  const cy = (n: number) => `${fmtNum(n, 2)} CY`;
  const totalWidth = input.trenchWidthFt + input.benchWidthFt * 2;
  const excavationCF = totalWidth * output.avgDepthFt * input.runLengthLF;
  const beddingCF = input.trenchWidthFt * input.beddingDepthFt * input.runLengthLF;
  const pipeRadiusFt = inchesToFeet(input.pipeSizeIn) / 2;
  const pipeCF = Math.PI * pipeRadiusFt ** 2 * output.pipeLF;

  return {
    avgDepth: {
      formula: 'Avg depth = (start depth + end depth) ÷ 2',
      lines: [
        { label: 'Start depth', value: ft(input.startDepthFt), kind: 'term' },
        { label: 'End depth', value: ft(output.endDepthFt), kind: 'term' },
        { label: 'Avg depth', value: ft(output.avgDepthFt), kind: 'result' },
      ],
      note: `End depth = start + grade (${fmtNum(input.gradePct, 2)}% × ${fmtNum(input.runLengthLF, 0)} LF).`,
    },
    excavation: {
      formula: 'Excavation = (width + 2 × bench) × avg depth × length ÷ 27',
      lines: [
        { label: 'Total width', value: `${ft(input.trenchWidthFt)} + 2 × ${ft(input.benchWidthFt)} = ${ft(totalWidth)}`, kind: 'term' },
        { label: 'Avg depth', value: ft(output.avgDepthFt), kind: 'term' },
        { label: 'Run length', value: `${fmtNum(input.runLengthLF, 2)} LF`, kind: 'term' },
        { label: 'Volume', value: `${fmtNum(excavationCF, 1)} CF ÷ 27`, kind: 'term' },
        { label: 'Excavation', value: cy(output.excavationCY), kind: 'result' },
      ],
    },
    bedding: {
      formula: 'Bedding = width × bedding depth × length ÷ 27',
      lines: [
        { label: 'Trench width', value: ft(input.trenchWidthFt), kind: 'term' },
        { label: 'Bedding depth', value: ft(input.beddingDepthFt), kind: 'term' },
        { label: 'Run length', value: `${fmtNum(input.runLengthLF, 2)} LF`, kind: 'term' },
        { label: 'Volume', value: `${fmtNum(beddingCF, 1)} CF ÷ 27`, kind: 'term' },
        { label: 'Bedding', value: cy(output.beddingCY), kind: 'result' },
      ],
    },
    backfill: {
      formula: 'Backfill = excavation − bedding − pipe',
      lines: [
        { label: 'Excavation', value: `${fmtNum(excavationCF, 1)} CF`, kind: 'term' },
        { label: 'Bedding', value: `${fmtNum(beddingCF, 1)} CF`, kind: 'term' },
        { label: 'Pipe displacement', value: `${fmtNum(pipeCF, 1)} CF`, kind: 'term' },
        { label: 'Backfill', value: cy(output.backfillCY), kind: 'result' },
      ],
      note: 'Subtracts the full pipe cylinder (bedding-to-invert); conservative for bedding-to-springline specs.',
    },
  };
}

/**
 * Extract the first inch-marked size from a material name -- '8" PVC SDR-35'
 * and 'PVC 8"' both parse as 8. The digits must be followed by an inch mark,
 * so spec numbers like 'SDR-35' or 'C-900' never match.
 */
export function parsePipeSizeFromName(name: string): number {
  const match = name.match(/(\d+(?:\/\d+)?(?:\.\d+)?)\s*['"]/);
  if (!match) return 0;
  const raw = match[1];
  if (raw.includes('/')) {
    const [num, den] = raw.split('/');
    return Number(num) / Number(den);
  }
  return Number(raw);
}
