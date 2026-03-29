/**
 * Trench Profiler calculation engine.
 *
 * Pure functions -- no React, no side effects.
 * Reused by the standalone TrenchProfiler component now
 * and by the plan takeoff viewer later.
 */

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
  if (input.gradePct < 0)
    errors.push({ field: 'gradePct', message: 'Grade cannot be negative' });
  if (input.runLengthLF <= 0)
    errors.push({ field: 'runLengthLF', message: 'Run length must be > 0' });
  if (input.trenchWidthFt <= 0)
    errors.push({ field: 'trenchWidthFt', message: 'Trench width must be > 0' });
  if (input.benchWidthFt < 0)
    errors.push({ field: 'benchWidthFt', message: 'Bench width cannot be negative' });

  if (input.beddingDepthFt < 0)
    errors.push({ field: 'beddingDepthFt', message: 'Bedding depth cannot be negative' });

  const pipeDiameterFt = input.pipeSizeIn / 12;
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
  const excavationCY = excavationCF / 27;

  // Bedding zone: full trench width x bedding depth x run length
  const beddingCF = trenchWidthFt * beddingDepthFt * runLengthLF;
  const beddingCY = beddingCF / 27;

  // Pipe volume (cylinder) -- subtract from backfill
  const pipeRadiusFt = (pipeSizeIn / 12) / 2;
  const pipeCF = Math.PI * pipeRadiusFt ** 2 * pipeLF;

  // Backfill = excavation - bedding - pipe
  const backfillCF = Math.max(excavationCF - beddingCF - pipeCF, 0);
  const backfillCY = backfillCF / 27;

  // Tracer wire and warning tape run the full horizontal length
  const tracerWireLF = runLengthLF;
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

/** Extract leading pipe size (inches) from a material name like '8" PVC SDR-35'. */
export function parsePipeSizeFromName(name: string): number {
  const match = name.match(/^(\d+(?:\/\d+)?(?:\.\d+)?)\s*['"]/);
  if (!match) return 0;
  const raw = match[1];
  if (raw.includes('/')) {
    const [num, den] = raw.split('/');
    return Number(num) / Number(den);
  }
  return Number(raw);
}
