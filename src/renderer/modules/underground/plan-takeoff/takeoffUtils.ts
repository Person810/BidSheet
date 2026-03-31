import type { TakeoffRun, PdfPoint } from './types';

/** OSHA 1926 Subpart P general threshold for protective systems */
export const SHORING_DEPTH_THRESHOLD_FT = 5;

/** Sum pixel distances between consecutive points, convert to linear feet. */
export function computeRunLengthLF(points: PdfPoint[], scalePxPerFt: number): number {
  let totalPx = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    totalPx += Math.sqrt(dx * dx + dy * dy);
  }
  return scalePxPerFt > 0 ? totalPx / scalePxPerFt : 0;
}

/** Maximum trench depth across the run (start vs end). */
export function getMaxDepthFt(run: TakeoffRun, scalePxPerFt: number): number {
  const runLengthLF = computeRunLengthLF(run.points, scalePxPerFt);
  const endDepthFt = run.startDepthFt + (run.gradePct / 100) * runLengthLF;
  return Math.max(run.startDepthFt, endDepthFt);
}
