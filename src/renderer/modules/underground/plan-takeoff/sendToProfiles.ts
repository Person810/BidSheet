import type { TakeoffRun, PdfPoint } from './types';

function computeRunLengthLF(points: PdfPoint[], scalePxPerFt: number): number {
  let totalPx = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    totalPx += Math.sqrt(dx * dx + dy * dy);
  }
  return totalPx / scalePxPerFt;
}

/**
 * Converts takeoff runs into trench profile records on the job.
 * Each run becomes one trench profile that the user can review/edit
 * before converting to bid line items via the existing workflow.
 * Returns the number of profiles created.
 */
export async function sendToProfiles(
  runs: TakeoffRun[],
  jobId: number,
  scalePxPerFt: number,
): Promise<number> {
  const completedRuns = runs.filter((r) => r.points.length >= 2);
  if (completedRuns.length === 0) return 0;

  for (let i = 0; i < completedRuns.length; i++) {
    const run = completedRuns[i];
    const runLengthLF = computeRunLengthLF(run.points, scalePxPerFt);
    if (runLengthLF <= 0) continue;

    await window.api.saveTrenchProfile({
      jobId,
      label: run.label || `Takeoff Run ${i + 1}`,
      pipeSizeIn: run.pipeSizeIn,
      pipeMaterial: run.pipeMaterial,
      pipeMaterialId: run.pipeMaterialId,
      startDepthFt: run.startDepthFt,
      gradePct: run.gradePct,
      runLengthLF,
      trenchWidthFt: run.trenchWidthFt,
      benchWidthFt: run.benchWidthFt,
      beddingType: run.beddingType,
      beddingDepthFt: run.beddingDepthFt,
      beddingMaterialId: run.beddingMaterialId,
      backfillType: run.backfillType,
      backfillMaterialId: run.backfillMaterialId,
      sortOrder: i,
    });
  }

  return completedRuns.length;
}
