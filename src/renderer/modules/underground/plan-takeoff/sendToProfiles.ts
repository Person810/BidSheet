import type { TakeoffRun } from './types';
import { computeRunLengthLF } from './takeoffUtils';

export interface SendToProfilesResult {
  /** Profiles created. */
  created: number;
  /** Per-run problems the caller should surface to the user. */
  warnings: string[];
}

/**
 * Converts takeoff runs into trench profile records on the job.
 * Each run becomes one trench profile that the user can review/edit
 * before converting to bid line items via the existing workflow.
 *
 * Loads per-page scales from DB so each run uses the correct scale
 * for its page.
 *
 * Trench profiles follow the trenchCalc convention: start at the upstream
 * (shallow) end with grade >= 0. A run traced downstream-to-upstream (both
 * endpoint inverts known, falling toward the first point) is flipped to the
 * equivalent positive-grade orientation; elevation data that can't yield a
 * valid profile (rim below invert) skips the run with a message instead of
 * failing validateInput downstream.
 *
 * Returns the number of profiles created, plus per-run warnings.
 */
export async function sendToProfiles(
  runs: TakeoffRun[],
  jobId: number,
): Promise<SendToProfilesResult> {
  const completedRuns = runs.filter((r) => r.points.length >= 2);
  if (completedRuns.length === 0) return { created: 0, warnings: [] };

  // Load all page scales for this job
  const scaleRows: any[] = await window.api.listPageScales(jobId);
  const scaleMap = new Map<number, number>();
  for (const row of scaleRows) {
    scaleMap.set(row.page_number, row.scale_px_per_ft);
  }

  let created = 0;
  const warnings: string[] = [];
  for (let i = 0; i < completedRuns.length; i++) {
    const run = completedRuns[i];
    const label = run.label || `Takeoff Run ${i + 1}`;
    const scalePxPerFt = scaleMap.get(run.pdfPage);
    if (!scalePxPerFt) continue; // skip runs on uncalibrated pages

    const runLengthLF = computeRunLengthLF(run.points, scalePxPerFt);
    if (runLengthLF <= 0) continue;

    // Use elevation data when available at the endpoints. When both inverts
    // are known and the run was traced from the downstream (deep) end, flip
    // the endpoints so the derived profile starts upstream with a positive
    // grade — the same trench, measured from the other end.
    let startDepthFt = run.startDepthFt;
    let gradePct = run.gradePct;
    const firstPt = run.points[0];
    const lastPt = run.points[run.points.length - 1];
    const flip =
      firstPt.invertElev != null && lastPt.invertElev != null &&
      firstPt.invertElev < lastPt.invertElev;
    const startPt = flip ? lastPt : firstPt;
    const endPt = flip ? firstPt : lastPt;
    if (startPt.invertElev != null && startPt.rimElev != null) {
      startDepthFt = startPt.rimElev - startPt.invertElev;
      if (startDepthFt <= 0) {
        warnings.push(
          `Skipped "${label}": rim elevation (${startPt.rimElev}) is at or below the invert ` +
          `(${startPt.invertElev}) at the ${flip ? 'end' : 'start'} point — check the elevations.`,
        );
        continue;
      }
    }
    if (startPt.invertElev != null && endPt.invertElev != null && runLengthLF > 0) {
      gradePct = ((startPt.invertElev - endPt.invertElev) / runLengthLF) * 100;
    }

    await window.api.saveTrenchProfile({
      jobId,
      label,
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
      hddAdditionalPipesJson: run.hddAdditionalPipesJson || null,
      sortOrder: i,
    });
    created++;
  }

  return { created, warnings };
}
