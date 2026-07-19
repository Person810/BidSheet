/**
 * Earthwork cut/fill calculation engine.
 *
 * Pure functions -- no React, no side effects. Same shape as trenchCalc.ts
 * (validate -> calculate -> explain) so it drops into the existing
 * "show the math" CalcBreakdown UI.
 *
 * Two ways to define proposed grade, both driven by a polygon footprint
 * (reuse TakeoffArea):
 *   - cut_depth / fill_depth : uniform depth below/above EXISTING grade.
 *       Volume = area x depth. Needs NO existing surface and NO TIN -- this
 *       is the "below-grade cut tool" and works with zero elevation data.
 *   - finished_elev          : absolute target elevation. Samples the
 *       existing-ground TIN on a grid and integrates (existing - finished)
 *       per cell, so cut and fill vary across the footprint with the terrain.
 */

import type { CalcBreakdown } from '../../../shared/calcExplain';
import { fmtNum } from '../../../shared/calcExplain';
import { cubicFeetToYards, squareFeetToYards } from '../../../shared/constants/units';
import {
  DEFAULT_UNIT_SYSTEM, convertQty, unitLabel, type UnitSystem,
} from '../../../shared/unitSystem';
import {
  buildTin, interpolateZ, polygonAreaSF, pointInPolygon, bbox,
  type Pt2, type Pt3, type Tin,
} from './surfaceModel';

// ---- Input / Output types --------------------------------------------------

export type GradeMode = 'cut_depth' | 'fill_depth' | 'finished_elev';

export interface ProposedRegion {
  id: number;
  label: string;
  /** Footprint polygon in FEET (PDF px already divided by scale_px_per_ft). */
  polygon: Pt2[];
  mode: GradeMode;
  /**
   * cut_depth / fill_depth : uniform depth in feet (> 0).
   * finished_elev          : absolute finished elevation in feet.
   */
  value: number;
}

export interface EarthworkInput {
  regions: ProposedRegion[];
  /** Existing-ground points in FEET. Only needed for finished_elev regions. */
  existingSurface?: Pt3[];
  /** Grid cell size (ft) for finished_elev sampling. Default 10. */
  gridSpacingFt?: number;
  /** Swell when excavated (loose vs bank), e.g. 0.25 = 25%. Default 0. */
  swellPct?: number;
  /** Shrink when fill is compacted (compacted vs bank), e.g. 0.15. Default 0. */
  shrinkPct?: number;
}

export interface RegionResult {
  id: number;
  label: string;
  mode: GradeMode;
  areaSF: number;
  areaSY: number;
  cutCY: number;   // bank
  fillCY: number;  // compacted in place
  /**
   * finished_elev only: grid cells inside the footprint with no existing-
   * surface coverage (outside the TIN hull). -1 means the surface itself was
   * missing, so the region couldn't be computed at all.
   */
  uncoveredCells: number;
}

export interface EarthworkOutput {
  regions: RegionResult[];
  totalCutCY: number;   // bank volume
  totalFillCY: number;  // compacted-in-place volume
  netCY: number;        // + = net cut (surplus), - = net fill (deficit)
  exportCY: number;     // loose CY to haul off site
  importCY: number;     // bank CY to bring in
}

export interface ValidationError { field: string; message: string; }

// ---- Validation ------------------------------------------------------------

export function validateEarthwork(input: EarthworkInput): ValidationError[] {
  const errors: ValidationError[] = [];

  if (input.regions.length === 0) {
    errors.push({ field: 'regions', message: 'Add at least one proposed-grade area' });
  }

  for (const r of input.regions) {
    const name = r.label || 'Region';
    if (r.polygon.length < 3) {
      errors.push({ field: `region:${r.id}`, message: `"${name}" needs at least 3 points` });
    }
    if ((r.mode === 'cut_depth' || r.mode === 'fill_depth') && r.value <= 0) {
      errors.push({ field: `region:${r.id}`, message: `"${name}" depth must be > 0` });
    }
  }

  const needsSurface = input.regions.some((r) => r.mode === 'finished_elev');
  if (needsSurface && (!input.existingSurface || input.existingSurface.length < 3)) {
    errors.push({
      field: 'existingSurface',
      message: 'Finished-elevation areas need at least 3 existing-grade points',
    });
  }

  if (input.swellPct != null && input.swellPct < 0)
    errors.push({ field: 'swellPct', message: 'Swell cannot be negative' });
  if (input.shrinkPct != null && (input.shrinkPct < 0 || input.shrinkPct >= 1))
    errors.push({ field: 'shrinkPct', message: 'Shrink must be between 0 and 1' });

  return errors;
}

// ---- Calculation -----------------------------------------------------------

export function calculateEarthwork(input: EarthworkInput): EarthworkOutput {
  const grid = input.gridSpacingFt && input.gridSpacingFt > 0 ? input.gridSpacingFt : 10;
  const needsSurface = input.regions.some((r) => r.mode === 'finished_elev');
  const tin: Tin | null =
    needsSurface && input.existingSurface && input.existingSurface.length >= 3
      ? buildTin(input.existingSurface)
      : null;

  const results: RegionResult[] = [];
  let totalCutCF = 0;
  let totalFillCF = 0;

  for (const r of input.regions) {
    const areaSF = polygonAreaSF(r.polygon);
    let cutCF = 0;
    let fillCF = 0;
    let uncovered = 0;

    if (r.mode === 'cut_depth') {
      cutCF = areaSF * Math.max(r.value, 0);
    } else if (r.mode === 'fill_depth') {
      fillCF = areaSF * Math.max(r.value, 0);
    } else if (tin) {
      // finished_elev: integrate (existing - finished) over a grid clipped
      // to the polygon. Positive delta is cut, negative is fill.
      const box = bbox(r.polygon);
      const cellArea = grid * grid;
      for (let x = box.minX + grid / 2; x <= box.maxX; x += grid) {
        for (let y = box.minY + grid / 2; y <= box.maxY; y += grid) {
          if (!pointInPolygon(x, y, r.polygon)) continue;
          const z = interpolateZ(tin, x, y);
          if (z == null) { uncovered++; continue; }
          const dz = z - r.value;
          if (dz > 0) cutCF += dz * cellArea;
          else fillCF += -dz * cellArea;
        }
      }
    } else {
      uncovered = -1; // finished_elev region but no usable existing surface
    }

    totalCutCF += cutCF;
    totalFillCF += fillCF;

    results.push({
      id: r.id,
      label: r.label,
      mode: r.mode,
      areaSF: round2(areaSF),
      areaSY: round2(squareFeetToYards(areaSF)),
      cutCY: round2(cubicFeetToYards(cutCF)),
      fillCY: round2(cubicFeetToYards(fillCF)),
      uncoveredCells: uncovered,
    });
  }

  const totalCutCY = cubicFeetToYards(totalCutCF);
  const totalFillCY = cubicFeetToYards(totalFillCF);
  const { netCY, exportCY, importCY } = haulBalance(
    totalCutCY, totalFillCY, input.swellPct ?? 0, input.shrinkPct ?? 0,
  );

  return {
    regions: results,
    totalCutCY: round2(totalCutCY),
    totalFillCY: round2(totalFillCY),
    netCY: round2(netCY),
    exportCY: round2(exportCY),
    importCY: round2(importCY),
  };
}

/**
 * Cut/fill -> haul balance, in bank terms. Producing `totalFillCY` of compacted
 * fill takes more bank soil when the material shrinks on compaction. Any bank
 * surplus is hauled off as loose (swelled) CY; any deficit is imported. With
 * swell=shrink=0 this collapses to export = max(net,0), import = max(-net,0).
 *
 * Exported so multi-page callers can sum per-page cut/fill and still compute
 * one job-level balance from the same formula the engine uses internally.
 */
export function haulBalance(
  totalCutCY: number, totalFillCY: number, swellPct = 0, shrinkPct = 0,
): { netCY: number; exportCY: number; importCY: number } {
  const fillBankNeedCY = shrinkPct < 1 ? totalFillCY / (1 - shrinkPct) : totalFillCY;
  const balanceBankCY = totalCutCY - fillBankNeedCY;
  return {
    netCY: totalCutCY - totalFillCY,
    exportCY: balanceBankCY > 0 ? balanceBankCY * (1 + swellPct) : 0,
    importCY: balanceBankCY < 0 ? -balanceBankCY : 0,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---- "Show the math" -------------------------------------------------------

/**
 * Re-derives the substituted arithmetic behind the totals so the summary
 * numbers are never a black box. Mirrors explainTrench in trenchCalc.ts.
 */
export function explainEarthwork(
  input: EarthworkInput,
  output: EarthworkOutput,
  system: UnitSystem = DEFAULT_UNIT_SYSTEM,
): {
  totals: CalcBreakdown;
  regions: CalcBreakdown[];
} {
  const metric = system === 'metric';
  const cy = (n: number) => `${fmtNum(convertQty(n, 'cy', system), 1)} ${unitLabel('cy', system)}`;
  const ft = (n: number) => `${fmtNum(convertQty(n, 'ft', system), 2)} ${unitLabel('ft', system)}`;
  const sf = (n: number) => `${fmtNum(convertQty(n, 'sf', system), 0)} ${unitLabel('sf', system)}`;

  const regions: CalcBreakdown[] = output.regions.map((r) => {
    if (r.mode === 'cut_depth' || r.mode === 'fill_depth') {
      const verb = r.mode === 'cut_depth' ? 'Cut' : 'Fill';
      const depth = input.regions.find((x) => x.id === r.id)?.value ?? 0;
      return {
        formula: metric ? `${verb} = area × depth` : `${verb} = area × depth ÷ 27`,
        lines: [
          { label: 'Area', value: sf(r.areaSF), kind: 'term' },
          { label: 'Depth', value: ft(depth), kind: 'term' },
          { label: verb, value: cy(r.mode === 'cut_depth' ? r.cutCY : r.fillCY), kind: 'result' },
        ],
        note: `"${r.label || 'Region'}" — uniform depth below existing grade; no surface model needed.`,
      };
    }
    const finished = input.regions.find((x) => x.id === r.id)?.value ?? 0;
    return {
      formula: metric
        ? 'Cut/Fill = Σ (existing − finished) × cell area'
        : 'Cut/Fill = Σ (existing − finished) × cell area ÷ 27',
      lines: [
        { label: 'Finished elevation', value: ft(finished), kind: 'term' },
        { label: 'Footprint', value: sf(r.areaSF), kind: 'term' },
        { label: 'Cut', value: cy(r.cutCY), kind: 'term' },
        { label: 'Fill', value: cy(r.fillCY), kind: 'result' },
      ],
      note:
        `"${r.label || 'Region'}" — sampled against existing TIN` +
        (r.uncoveredCells > 0
          ? `. ${r.uncoveredCells} grid cell(s) had no existing-grade data and were skipped.`
          : r.uncoveredCells < 0
            ? '. No existing surface available — add spot elevations or contours.'
            : '.'),
    };
  });

  const totals: CalcBreakdown = {
    formula: 'Net = total cut − total fill (bank); export/import after swell & shrink',
    lines: [
      { label: 'Total cut', value: cy(output.totalCutCY), kind: 'term' },
      { label: 'Total fill', value: cy(output.totalFillCY), kind: 'term' },
      { label: 'Net', value: `${cy(Math.abs(output.netCY))} ${output.netCY >= 0 ? 'cut (surplus)' : 'fill (deficit)'}`, kind: 'term' },
      { label: 'Export', value: cy(output.exportCY), kind: 'result' },
      { label: 'Import', value: cy(output.importCY), kind: 'result' },
    ],
    note: `Swell ${fmtNum((input.swellPct ?? 0) * 100, 0)}%, shrink ${fmtNum((input.shrinkPct ?? 0) * 100, 0)}%. Export is loose ${unitLabel('cy', system)} hauled off; import is bank ${unitLabel('cy', system)} brought in.`,
  };

  return { totals, regions };
}
