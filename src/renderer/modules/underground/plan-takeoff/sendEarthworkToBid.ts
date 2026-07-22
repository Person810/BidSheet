import type { TakeoffArea, TakeoffSurface } from './types';
import { loadPageScaleMap } from './takeoffUtils';
import { buildLineItemPayload } from '../../../../shared/lineItemPayload';
import {
  bidLineQty, unitLabel, DEFAULT_UNIT_SYSTEM, type UnitSystem,
} from '../../../../shared/unitSystem';
import {
  calculateEarthwork, haulBalance, type ProposedRegion,
} from '../earthworkCalc';
import type { Pt3 } from '../surfaceModel';

export interface SendEarthworkResult {
  /** Line items created. */
  created: number;
  /** Non-fatal coverage problems the caller should surface to the user. */
  warnings: string[];
}

/**
 * Converts earthwork areas (a TakeoffArea with gradeMode set) into bid line
 * items in an "Earthwork" section. Cut/fill is computed per page so each
 * polygon and the existing-surface TIN share one page's scale and coordinate
 * space; the haul balance (export/import) is then taken once over the job
 * totals. Surface restoration areas (gradeMode null) are ignored here.
 *
 * Returns the number of line items created, plus warnings when the existing-
 * surface data doesn't cover every finished-elevation region — those volumes
 * are understated and the user needs to know before trusting the lines.
 */
export async function sendEarthworkToBid(
  areas: TakeoffArea[],
  surfaces: TakeoffSurface[],
  jobId: number,
  system: UnitSystem = DEFAULT_UNIT_SYSTEM,
  opts: { gridSpacingFt?: number; swellPct?: number; shrinkPct?: number } = {},
): Promise<SendEarthworkResult> {
  const earthworkAreas = areas.filter((a) => a.gradeMode != null && a.points.length >= 3);
  if (earthworkAreas.length === 0) return { created: 0, warnings: [] };

  const scaleByPage = await loadPageScaleMap(jobId);
  const existingPoints = surfaces
    .filter((s) => s.kind === 'existing')
    .flatMap((s) => s.points);

  // Group earthwork areas by page so each batch converts with its own scale.
  const pages = new Set(earthworkAreas.map((a) => a.pdfPage));
  let totalCutCY = 0;
  let totalFillCY = 0;
  // Coverage problems per region: cells inside a footprint with no existing-
  // grade data mean that part of the cut/fill was silently skipped.
  let uncoveredCellsTotal = 0;
  const missingSurfaceRegions: string[] = [];
  const partialCoverageRegions: string[] = [];

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
    for (const r of out.regions) {
      if (r.uncoveredCells > 0) {
        uncoveredCellsTotal += r.uncoveredCells;
        partialCoverageRegions.push(r.label || 'Untitled region');
      } else if (r.uncoveredCells < 0) {
        missingSurfaceRegions.push(r.label || 'Untitled region');
      }
    }
  }

  const warnings: string[] = [];
  if (missingSurfaceRegions.length > 0) {
    warnings.push(
      `No existing surface for ${missingSurfaceRegions.map((l) => `"${l}"`).join(', ')} — ` +
      'cut/fill for these finished-elevation regions was NOT counted. Add spot elevations and re-send.',
    );
  }
  if (uncoveredCellsTotal > 0) {
    warnings.push(
      `Existing-grade data doesn't cover all of ${partialCoverageRegions.map((l) => `"${l}"`).join(', ')} ` +
      `(${uncoveredCellsTotal} grid cell(s) skipped) — cut/fill is understated. ` +
      'Add spot elevations across each region and re-send.',
    );
  }

  if (totalCutCY <= 0 && totalFillCY <= 0) return { created: 0, warnings };

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

  const vol = unitLabel('cy', system); // "CY" / "m³" in the provenance notes
  const lines: { description: string; quantity: number; notes: string }[] = [];
  if (totalCutCY > 0) {
    lines.push({ description: 'Excavation (Cut)', quantity: round1(totalCutCY), notes: 'From plan takeoff — bank volume' });
  }
  if (totalFillCY > 0) {
    lines.push({ description: 'Embankment (Fill)', quantity: round1(totalFillCY), notes: 'From plan takeoff — compacted in place' });
  }
  if (exportCY > 0) {
    lines.push({ description: 'Export / Haul Off', quantity: round1(exportCY), notes: `Surplus hauled off (loose ${vol})` });
  }
  if (importCY > 0) {
    lines.push({ description: 'Import / Borrow', quantity: round1(importCY), notes: `Deficit brought in (bank ${vol})` });
  }

  let sortOrder = 0;
  for (const l of lines) {
    const { quantity, unit } = bidLineQty(l.quantity, 'cy', system, 'CYD');
    await window.api.saveBidLineItem(buildLineItemPayload({
      sectionId,
      jobId,
      description: l.description,
      quantity,
      unit,
      sortOrder: sortOrder++,
      materialId: null,
      materialUnitCost: 0,
      notes: `${l.notes} — set unit cost manually`,
    }));
  }

  return { created: lines.length, warnings };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
