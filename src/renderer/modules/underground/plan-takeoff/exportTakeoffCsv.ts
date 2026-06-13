import type { TakeoffRun, TakeoffItem, TakeoffArea } from './types';
import { AREA_TYPE_LABELS } from './types';
import {
  computeRunLengthLF, computePolygonAreaSF, computePolygonPerimeterLF,
  ftToInches, loadPageScaleMap,
} from './takeoffUtils';
import { calculateTrench } from '../trenchCalc';
import { neutralizeCsvFormula } from '../../../../shared/csvSafe';

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
): Promise<string> {
  const scaleByPage = await loadPageScaleMap(jobId);

  const lines: string[] = [];
  // UTF-8 BOM for Excel compatibility
  lines.push('\uFEFF' + 'TAKEOFF QUANTITY REPORT');
  lines.push('');

  // ---- Pipe runs ----
  const completedRuns = runs.filter((r) => r.points.length >= 2);
  if (completedRuns.length > 0) {
    lines.push('PIPE RUNS');
    lines.push(row(
      'Page', 'Label', 'Utility', 'Pipe Material', 'Size (in)', 'Length (LF)',
      'Excavation (CY)', 'Bedding (CY)', 'Backfill (CY)', 'Tracer Wire (LF)', 'Warning Tape (LF)',
    ));
    const totals = { lf: 0, exc: 0, bed: 0, back: 0 };
    for (const run of completedRuns) {
      const scale = scaleByPage.get(run.pdfPage);
      const label = run.label || 'Untitled Run';
      if (!scale) {
        lines.push(row(run.pdfPage, label, run.utilityType, run.pipeMaterial, run.pipeSizeIn,
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
        run.pdfPage, label, run.utilityType, run.pipeMaterial, run.pipeSizeIn,
        lf.toFixed(1), result.excavationCY.toFixed(1), result.beddingCY.toFixed(1),
        result.backfillCY.toFixed(1), result.tracerWireLF.toFixed(1), result.warningTapeLF.toFixed(1),
      ));
    }
    lines.push(row('', 'TOTAL', '', '', '', totals.lf.toFixed(1),
      totals.exc.toFixed(1), totals.bed.toFixed(1), totals.back.toFixed(1), '', ''));
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
    lines.push(row(
      'Page', 'Label', 'Surface', 'Depth (in)', 'Area (SF)', 'Area (SY)', 'Volume (CY)', 'Perimeter (LF)',
    ));
    const totals = { sf: 0, cy: 0 };
    for (const area of completedAreas) {
      const scale = scaleByPage.get(area.pdfPage);
      const label = area.label || 'Untitled Area';
      const surface = AREA_TYPE_LABELS[area.areaType] ?? area.areaType;
      const depthIn = ftToInches(area.depthFt);
      if (!scale) {
        lines.push(row(area.pdfPage, label, surface, depthIn, 'page not calibrated', '', '', ''));
        continue;
      }
      const sf = computePolygonAreaSF(area.points, scale);
      const cy = (sf * area.depthFt) / 27;
      totals.sf += sf;
      totals.cy += cy;
      lines.push(row(
        area.pdfPage, label, surface, depthIn,
        sf.toFixed(0), (sf / 9).toFixed(1), cy > 0 ? cy.toFixed(1) : '',
        computePolygonPerimeterLF(area.points, scale).toFixed(1),
      ));
    }
    lines.push(row('', 'TOTAL', '', '', totals.sf.toFixed(0), (totals.sf / 9).toFixed(1),
      totals.cy > 0 ? totals.cy.toFixed(1) : '', ''));
    lines.push('');
  }

  return lines.join('\r\n') + '\r\n';
}
