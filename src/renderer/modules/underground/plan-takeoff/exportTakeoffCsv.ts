import type { TakeoffRun, TakeoffItem, TakeoffArea } from './types';
import { AREA_TYPE_LABELS } from './types';
import {
  computeRunLengthLF, computePolygonAreaSF, computePolygonPerimeterLF,
  ftToInches, loadPageScaleMap,
} from './takeoffUtils';
import { calculateTrench } from '../trenchCalc';
import { neutralizeCsvFormula } from '../../../../shared/csvSafe';
import { cubicFeetToYards, squareFeetToYards } from '../../../../shared/constants/units';
import {
  DEFAULT_UNIT_SYSTEM, convertQty, formatPipeSize, type UnitSystem,
} from '../../../../shared/unitSystem';

/**
 * Escape a field for CSV: neutralize spreadsheet formula injection, then quote
 * per RFC 4180 (comma, quote, or newline).
 */
function esc(value: string | number): string {
  const s = neutralizeCsvFormula(String(value));
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function row(...fields: (string | number)[]): string {
  return fields.map(esc).join(',');
}

/**
 * Builds a takeoff quantity report CSV with three blocks: pipe runs (with
 * trench volumes), count items grouped by material, and measured areas.
 * Runs/areas on uncalibrated pages are listed without quantities.
 */
export async function buildTakeoffCsv(
  jobId: number,
  runs: TakeoffRun[],
  items: TakeoffItem[],
  areas: TakeoffArea[],
  system: UnitSystem = DEFAULT_UNIT_SYSTEM,
): Promise<string> {
  const scaleByPage = await loadPageScaleMap(jobId);
  const metric = system === 'metric';
  // Quantities are computed in canonical imperial and converted only when
  // printed; imperial output is unchanged.
  const len = (lf: number) => (metric ? convertQty(lf, 'lf', system) : lf).toFixed(1);
  const vol = (cy: number) => (metric ? convertQty(cy, 'cy', system) : cy).toFixed(1);

  const lines: string[] = [];
  // UTF-8 BOM for Excel compatibility
  lines.push('\uFEFF' + 'TAKEOFF QUANTITY REPORT');
  lines.push('');

  // ---- Pipe runs ----
  const completedRuns = runs.filter((r) => r.points.length >= 2);
  if (completedRuns.length > 0) {
    lines.push('PIPE RUNS');
    lines.push(metric
      ? row(
          'Page', 'Label', 'Utility', 'Pipe Material', 'Size', 'Length (m)',
          'Excavation (m³)', 'Bedding (m³)', 'Backfill (m³)', 'Tracer Wire (m)', 'Warning Tape (m)',
        )
      : row(
          'Page', 'Label', 'Utility', 'Pipe Material', 'Size (in)', 'Length (LF)',
          'Excavation (CY)', 'Bedding (CY)', 'Backfill (CY)', 'Tracer Wire (LF)', 'Warning Tape (LF)',
        ));
    const totals = { lf: 0, exc: 0, bed: 0, back: 0 };
    for (const run of completedRuns) {
      const scale = scaleByPage.get(run.pdfPage);
      const label = run.label || 'Untitled Run';
      const sizeCol = metric ? formatPipeSize(run.pipeSizeIn, system) : run.pipeSizeIn;
      if (!scale) {
        lines.push(row(run.pdfPage, label, run.utilityType, run.pipeMaterial, sizeCol,
          'page not calibrated', '', '', '', '', ''));
        continue;
      }
      const lf = computeRunLengthLF(run.points, scale);
      const result = calculateTrench({
        pipeSizeIn: run.pipeSizeIn, pipeMaterial: run.pipeMaterial,
        startDepthFt: run.startDepthFt, gradePct: run.gradePct, runLengthLF: lf,
        trenchWidthFt: run.trenchWidthFt, benchWidthFt: run.benchWidthFt,
        beddingDepthFt: run.beddingDepthFt, backfillType: run.backfillType,
      });
      totals.lf += lf;
      totals.exc += result.excavationCY;
      totals.bed += result.beddingCY;
      totals.back += result.backfillCY;
      lines.push(row(
        run.pdfPage, label, run.utilityType, run.pipeMaterial, sizeCol,
        len(lf), vol(result.excavationCY), vol(result.beddingCY),
        vol(result.backfillCY), len(result.tracerWireLF), len(result.warningTapeLF),
      ));
    }
    lines.push(row('', 'TOTAL', '', '', '', len(totals.lf),
      vol(totals.exc), vol(totals.bed), vol(totals.back), '', ''));
    lines.push('');
  }

  // ---- Count items (grouped by material) ----
  if (items.length > 0) {
    lines.push('COUNT ITEMS');
    lines.push(row('Material', 'Quantity', 'Pages'));
    const groups = new Map<string, { name: string; qty: number; pages: Set<number> }>();
    for (const item of items) {
      const key = item.materialId != null ? String(item.materialId) : item.materialName;
      const g = groups.get(key);
      if (g) {
        g.qty += item.quantity;
        g.pages.add(item.pdfPage);
      } else {
        groups.set(key, { name: item.materialName, qty: item.quantity, pages: new Set([item.pdfPage]) });
      }
    }
    for (const g of groups.values()) {
      lines.push(row(g.name, g.qty, Array.from(g.pages).sort((a, b) => a - b).join(' ')));
    }
    lines.push('');
  }

  // ---- Measured areas ----
  const completedAreas = areas.filter((a) => a.points.length >= 3);
  if (completedAreas.length > 0) {
    lines.push('MEASURED AREAS');
    // Metric has one area spelling (m²), so the redundant SF/SY pair
    // collapses to a single column — same as the in-app summary panel.
    lines.push(metric
      ? row('Page', 'Label', 'Surface', 'Depth (mm)', 'Area (m²)', 'Volume (m³)', 'Perimeter (m)')
      : row(
          'Page', 'Label', 'Surface', 'Depth (in)', 'Area (SF)', 'Area (SY)', 'Volume (CY)', 'Perimeter (LF)',
        ));
    const area2 = (sf: number) => (metric ? convertQty(sf, 'sf', system).toFixed(1) : sf.toFixed(0));
    const totals = { sf: 0, cy: 0 };
    for (const area of completedAreas) {
      const scale = scaleByPage.get(area.pdfPage);
      const label = area.label || 'Untitled Area';
      const surface = AREA_TYPE_LABELS[area.areaType] ?? area.areaType;
      const depthIn = ftToInches(area.depthFt);
      const depthCol = metric ? Math.round(convertQty(depthIn, 'in', system)) : depthIn;
      if (!scale) {
        lines.push(metric
          ? row(area.pdfPage, label, surface, depthCol, 'page not calibrated', '', '')
          : row(area.pdfPage, label, surface, depthCol, 'page not calibrated', '', '', ''));
        continue;
      }
      const sf = computePolygonAreaSF(area.points, scale);
      const cy = cubicFeetToYards(sf * area.depthFt);
      totals.sf += sf;
      totals.cy += cy;
      const perim = computePolygonPerimeterLF(area.points, scale);
      lines.push(metric
        ? row(area.pdfPage, label, surface, depthCol,
            area2(sf), cy > 0 ? vol(cy) : '', len(perim))
        : row(area.pdfPage, label, surface, depthCol,
            sf.toFixed(0), squareFeetToYards(sf).toFixed(1), cy > 0 ? cy.toFixed(1) : '',
            perim.toFixed(1)));
    }
    lines.push(metric
      ? row('', 'TOTAL', '', '', area2(totals.sf), totals.cy > 0 ? vol(totals.cy) : '', '')
      : row('', 'TOTAL', '', '', totals.sf.toFixed(0), squareFeetToYards(totals.sf).toFixed(1),
          totals.cy > 0 ? totals.cy.toFixed(1) : '', ''));
    lines.push('');
  }

  return lines.join('\r\n') + '\r\n';
}
