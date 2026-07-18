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

/**
 * Sentinel label for excavated-native backfill. Compaction/waste never
 * applies to it: you aren't buying native material, and its compaction
 * shortfall is offset by excavation swell.
 */
export const NATIVE_BACKFILL_LABEL = 'Native Material';

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
  /**
   * Extra loose material purchased per compacted CY of *imported*
   * bedding/backfill (issue #9, trimmed scope). 15 = buy 15% more than
   * the neat-line volume. Applies to bedding always and to backfill
   * unless it is NATIVE_BACKFILL_LABEL. 0/undefined = off.
   */
  compactionPct?: number;
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
    errors.push({ field: 'gradePct', message: 'Grade cannot be negative. Measure from the upstream (shallow) end.' });
  if (input.runLengthLF <= 0)
    errors.push({ field: 'runLengthLF', message: 'Run length must be > 0' });
  if (input.trenchWidthFt <= 0)
    errors.push({ field: 'trenchWidthFt', message: 'Trench width must be > 0' });
  if (input.benchWidthFt < 0)
    errors.push({ field: 'benchWidthFt', message: 'Bench width cannot be negative' });

  if (input.beddingDepthFt < 0)
    errors.push({ field: 'beddingDepthFt', message: 'Bedding depth cannot be negative' });

  const compactionPct = input.compactionPct ?? 0;
  if (compactionPct < 0 || compactionPct > 100)
    errors.push({ field: 'compactionPct', message: 'Compaction/waste must be between 0 and 100%' });

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

  // Compaction/waste: purchased loose volume per compacted CY of imported
  // material. Bedding is always imported; backfill only when not native.
  const compactionFactor = 1 + (input.compactionPct ?? 0) / 100;
  const backfillFactor =
    input.backfillType === NATIVE_BACKFILL_LABEL ? 1 : compactionFactor;

  // Bedding zone: full trench width x bedding depth x run length
  const beddingCF = trenchWidthFt * beddingDepthFt * runLengthLF;
  const beddingCY = cubicFeetToYards(beddingCF) * compactionFactor;

  // Pipe volume (cylinder) -- subtract from backfill
  const pipeRadiusFt = inchesToFeet(pipeSizeIn) / 2;
  const pipeCF = Math.PI * pipeRadiusFt ** 2 * pipeLF;

  // Backfill = excavation - bedding - pipe. Subtracting the full cylinder
  // assumes the pipe sits entirely above the bedding zone (bedding to
  // invert). For bedding-to-springline specs this slightly understates
  // backfill -- conservative, and within takeoff tolerance.
  const backfillCF = Math.max(excavationCF - beddingCF - pipeCF, 0);
  const backfillCY = cubicFeetToYards(backfillCF) * backfillFactor;

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

// ---- Depth-zone summary -----------------------------------------------------

export interface DepthZone {
  label: string;
  lf: number;
  excavationCY: number;
}

/**
 * Depth bands the run is bucketed into for the summary below. 5/10/15 ft
 * line up with OSHA's shoring/trench-box trigger depths, which is the same
 * break utility estimators actually price against -- matches the depth-zone
 * reports AGTEK, Carlson ("Depth Summary"), and MudShark all ship.
 */
export const DEFAULT_DEPTH_BREAKS_FT = [5, 10, 15, 20];

/**
 * Splits the run into depth bands and reports the horizontal length and
 * excavation volume in each -- e.g. "40 LF / 22 CY under 5 ft, 60 LF / 55 CY
 * from 5-10 ft". Depth is linear in station (constant grade), so each band
 * maps to a contiguous station range; a flat run (gradePct = 0) sits in
 * exactly one band for its whole length.
 */
export function depthZoneBreakdown(
  input: TrenchInput,
  breaksFt: number[] = DEFAULT_DEPTH_BREAKS_FT,
): DepthZone[] {
  const { startDepthFt, gradePct, runLengthLF, trenchWidthFt, benchWidthFt } = input;
  if (runLengthLF <= 0 || trenchWidthFt <= 0) return [];

  const fallFt = (gradePct / 100) * runLengthLF;
  const endDepthFt = startDepthFt + fallFt;
  const totalWidthFt = trenchWidthFt + benchWidthFt * 2;
  const sortedBreaks = [...new Set(breaksFt)].sort((a, b) => a - b);
  const bounds = [0, ...sortedBreaks, Infinity];

  const zoneLabel = (lo: number, hi: number) =>
    hi === Infinity ? `${fmtNum(lo, 0)}+ ft` : `${fmtNum(lo, 0)}–${fmtNum(hi, 0)} ft`;

  const zones: DepthZone[] = [];

  if (fallFt === 0) {
    // Flat trench: the whole run sits at one depth, so it belongs to exactly one band.
    for (let i = 0; i < bounds.length - 1; i++) {
      const lo = bounds[i];
      const hi = bounds[i + 1];
      if (startDepthFt >= lo && startDepthFt < hi) {
        const excavationCF = totalWidthFt * startDepthFt * runLengthLF;
        zones.push({
          label: zoneLabel(lo, hi),
          lf: round2(runLengthLF),
          excavationCY: round2(cubicFeetToYards(excavationCF)),
        });
        break;
      }
    }
    return zones;
  }

  const loDepth = Math.min(startDepthFt, endDepthFt);
  const hiDepth = Math.max(startDepthFt, endDepthFt);
  const stationAtDepth = (d: number) => ((d - startDepthFt) * runLengthLF) / fallFt;

  for (let i = 0; i < bounds.length - 1; i++) {
    const binLo = bounds[i];
    const binHi = bounds[i + 1];
    const d0 = Math.max(loDepth, binLo);
    const d1 = Math.min(hiDepth, binHi);
    if (d1 <= d0) continue;

    const lf = Math.abs(stationAtDepth(d1) - stationAtDepth(d0));
    if (lf <= 0) continue;

    const avgDepth = (d0 + d1) / 2;
    const excavationCF = totalWidthFt * avgDepth * lf;
    zones.push({
      label: zoneLabel(binLo, binHi),
      lf: round2(lf),
      excavationCY: round2(cubicFeetToYards(excavationCF)),
    });
  }

  return zones;
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

  const compactionPct = input.compactionPct ?? 0;
  const backfillCompacts =
    compactionPct > 0 && input.backfillType !== NATIVE_BACKFILL_LABEL;
  const compactionLine = {
    label: 'Compaction/waste',
    value: `+ ${fmtNum(compactionPct, 1)}%`,
    kind: 'term' as const,
  };

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
      formula: compactionPct > 0
        ? 'Bedding = width × bedding depth × length ÷ 27, plus compaction/waste'
        : 'Bedding = width × bedding depth × length ÷ 27',
      lines: [
        { label: 'Trench width', value: ft(input.trenchWidthFt), kind: 'term' },
        { label: 'Bedding depth', value: ft(input.beddingDepthFt), kind: 'term' },
        { label: 'Run length', value: `${fmtNum(input.runLengthLF, 2)} LF`, kind: 'term' },
        { label: 'Volume', value: `${fmtNum(beddingCF, 1)} CF ÷ 27`, kind: 'term' },
        ...(compactionPct > 0 ? [compactionLine] : []),
        { label: 'Bedding', value: cy(output.beddingCY), kind: 'result' },
      ],
    },
    backfill: {
      formula: backfillCompacts
        ? 'Backfill = (excavation − bedding − pipe), plus compaction/waste'
        : 'Backfill = excavation − bedding − pipe',
      lines: [
        { label: 'Excavation', value: `${fmtNum(excavationCF, 1)} CF`, kind: 'term' },
        { label: 'Bedding', value: `${fmtNum(beddingCF, 1)} CF`, kind: 'term' },
        { label: 'Pipe displacement', value: `${fmtNum(pipeCF, 1)} CF`, kind: 'term' },
        ...(backfillCompacts ? [compactionLine] : []),
        { label: 'Backfill', value: cy(output.backfillCY), kind: 'result' },
      ],
      note: backfillCompacts
        ? 'Subtracts the full pipe cylinder (bedding-to-invert); conservative for bedding-to-springline specs. Native backfill never carries compaction/waste.'
        : 'Subtracts the full pipe cylinder (bedding-to-invert); conservative for bedding-to-springline specs.',
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
