import type { TakeoffRun } from './types';
import { computeRunLengthLF } from './takeoffUtils';

/**
 * Converts takeoff runs into trench profile records on the job.
 * Each run becomes one trench profile that the user can review/edit
 * before converting to bid line items via the existing workflow.
 *
 * Loads per-page scales from DB so each run uses the correct scale
 * for its page.
 *
 * Returns the number of profiles created.
 */
export async function sendToProfiles(
  runs: TakeoffRun[],
  jobId: number,
): Promise<number> {
  const completedRuns = runs.filter((r) => r.points.length >= 2);
  if (completedRuns.length === 0) return 0;

  // Load all page scales for this job
  const scaleRows: any[] = await window.api.listPageScales(jobId);
  const scaleMap = new Map<number, number>();
  for (const row of scaleRows) {
    scaleMap.set(row.page_number, row.scale_px_per_ft);
  }

  let created = 0;
  for (let i = 0; i < completedRuns.length; i++) {
    const run = completedRuns[i];
    const scalePxPerFt = scaleMap.get(run.pdfPage);
    if (!scalePxPerFt) continue; // skip runs on uncalibrated pages

    const runLengthLF = computeRunLengthLF(run.points, scalePxPerFt);
    if (runLengthLF <= 0) continue;

    // Use elevation data when available at both endpoints
    let startDepthFt = run.startDepthFt;
    let gradePct = run.gradePct;
    const firstPt = run.points[0];
    const lastPt = run.points[run.points.length - 1];
    if (firstPt.invertElev != null && firstPt.rimElev != null) {
      startDepthFt = firstPt.rimElev - firstPt.invertElev;
    }
    if (firstPt.invertElev != null && lastPt.invertElev != null && runLengthLF > 0) {
      gradePct = ((firstPt.invertElev - lastPt.invertElev) / runLengthLF) * 100;
    }

    await window.api.saveTrenchProfile({
      jobId,
      label: run.label || `Takeoff Run ${i + 1}`,
      pipeSizeIn: run.pipeSizeIn,
      pipeMaterial: run.pipeMaterial,
      pipeMaterialId: run.pipeMaterialId,
      startDepthFt,
      gradePct,
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
    created++;
  }

  return created;
}
