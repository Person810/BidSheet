import type { TakeoffArea, TakeoffSurface } from './types';
import { loadPageScaleMap } from './takeoffUtils';
import { buildLineItemPayload } from '../../../../shared/lineItemPayload';
import {
  calculateEarthwork, haulBalance, type ProposedRegion,
} from '../earthworkCalc';
import type { Pt3 } from '../surfaceModel';

/**
 * Converts earthwork areas (a TakeoffArea with gradeMode set) into bid line
 * items in an "Earthwork" section. Cut/fill is computed per page so each
 * polygon and the existing-surface TIN share one page's scale and coordinate
 * space; the haul balance (export/import) is then taken once over the job
 * totals. Surface restoration areas (gradeMode null) are ignored here.
 *
 * Returns the number of line items created.
 */
export async function sendEarthworkToBid(
  areas: TakeoffArea[],
  surfaces: TakeoffSurface[],
  jobId: number,
  opts: { gridSpacingFt?: number; swellPct?: number; shrinkPct?: number } = {},
): Promise<number> {
  const earthworkAreas = areas.filter((a) => a.gradeMode != null && a.points.length >= 3);
  if (earthworkAreas.length === 0) return 0;

  const scaleByPage = await loadPageScaleMap(jobId);
  const existingPoints = surfaces
    .filter((s) => s.kind === 'existing')
    .flatMap((s) => s.points);

  // Group earthwork areas by page so each batch converts with its own scale.
  const pages = new Set(earthworkAreas.map((a) => a.pdfPage));
  let totalCutCY = 0;
  let totalFillCY = 0;

  for (const page of pages) {
    const scale = scaleByPage.get(page);
    if (!scale) continue; // uncalibrated page — skip, like sendAreasToBid

    const regions: ProposedRegion[] = earthworkAreas
      .filter((a) => a.pdfPage === page)
      .map((a) => ({
        id: a.id,
        label: a.label,
        polygon: a.points.map((p) => ({ x: p.x / scale, y: p.y / scale })),
        mode: a.gradeMode!,
        value: a.gradeValueFt ?? a.depthFt,
      }));

    const existingSurface: Pt3[] = existingPoints
      .filter((p) => p.pdfPage === page)
      .map((p) => ({ x: p.x / scale, y: p.y / scale, z: p.z }));

    const out = calculateEarthwork({
      regions,
      existingSurface,
      gridSpacingFt: opts.gridSpacingFt,
      // Per-page swell/shrink would double-count against the job balance, so
      // accumulate raw cut/fill here and apply factors once to the totals.
    });
    totalCutCY += out.totalCutCY;
    totalFillCY += out.totalFillCY;
  }

  if (totalCutCY <= 0 && totalFillCY <= 0) return 0;

  const { exportCY, importCY } = haulBalance(
    totalCutCY, totalFillCY, opts.swellPct ?? 0, opts.shrinkPct ?? 0,
  );

  const sections: any[] = await window.api.getBidSections(jobId);
  const sectionResult = await window.api.saveBidSection({
    jobId,
    name: 'Earthwork',
    sortOrder: sections.length,
  });
  const sectionId = sectionResult.id;

  const lines: { description: string; quantity: number; notes: string }[] = [];
  if (totalCutCY > 0) {
    lines.push({ description: 'Excavation (Cut)', quantity: round1(totalCutCY), notes: 'From plan takeoff — bank volume' });
  }
  if (totalFillCY > 0) {
    lines.push({ description: 'Embankment (Fill)', quantity: round1(totalFillCY), notes: 'From plan takeoff — compacted in place' });
  }
  if (exportCY > 0) {
    lines.push({ description: 'Export / Haul Off', quantity: round1(exportCY), notes: 'Surplus hauled off (loose CY)' });
  }
  if (importCY > 0) {
    lines.push({ description: 'Import / Borrow', quantity: round1(importCY), notes: 'Deficit brought in (bank CY)' });
  }

  let sortOrder = 0;
  for (const l of lines) {
    await window.api.saveBidLineItem(buildLineItemPayload({
      sectionId,
      jobId,
      description: l.description,
      quantity: l.quantity,
      unit: 'CYD',
      sortOrder: sortOrder++,
      materialId: null,
      materialUnitCost: 0,
      notes: `${l.notes} — set unit cost manually`,
    }));
  }

  return lines.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
