/**
 * Bid-analysis roll-up: the sanity-check numbers an estimator eyeballs
 * before submitting — total effort (labor hours, crew-days, equipment
 * hours), margin by section, and $/LF by pipe size. Pure functions so the
 * report is testable; the modal just renders this.
 */

import {
  computeBidSummary,
  sectionParams,
  type BidJobParams,
  type BidTotals,
} from '../../../shared/bidCalc';
import { parsePipeSizeFromName } from '../../modules/underground/trenchCalc';
import { METERS_PER_FOOT } from '../../../shared/unitSystem';

/** Crew-day conversion used for the effort strip (single-shift day). */
export const CREW_DAY_HOURS = 8;

export interface SectionAnalysis {
  sectionId: number;
  name: string;
  isAlternate: boolean;
  material: number;
  labor: number;
  equipment: number;
  sub: number;
  directCost: number;
  laborHours: number;
  equipmentHours: number;
  /** Marked-up total using the same per-section override logic as the bid */
  sellTotal: number;
  /** sellTotal − directCost */
  margin: number;
  /** Total pipe length in canonical LF (LF or metric-m lines, size-marked name) */
  pipeLF: number;
}

export interface PipeSizeAnalysis {
  sizeIn: number;
  totalLF: number;
  directCost: number;
  directPerLF: number;
}

export interface BidAnalysis {
  laborHours: number;
  crewDays: number;
  equipmentHours: number;
  sections: SectionAnalysis[];
  pipeSizes: PipeSizeAnalysis[];
}

/** True for line items that represent pipe runs: LF (or metric m) unit with a
 *  size-marked name (`8" PVC` / `DN200 PVC`). Returns nominal inches, 0 = not pipe. */
function pipeSizeOf(item: any): number {
  const unit = String(item.unit || '').toUpperCase();
  if (unit !== 'LF' && unit !== 'M') return 0;
  return parsePipeSizeFromName(String(item.description || ''));
}

/** Pipe-line quantity in canonical LF — metric lines are quantified in metres. */
function pipeQtyLF(item: any): number {
  const qty = item.quantity || 0;
  return String(item.unit || '').toUpperCase() === 'M' ? qty / METERS_PER_FOOT : qty;
}

export function computeBidAnalysis(
  sections: any[],
  lineItems: Record<number, any[]>,
  job: BidJobParams,
): BidAnalysis {
  let laborHours = 0;
  let equipmentHours = 0;
  const sectionRows: SectionAnalysis[] = [];
  const bySize = new Map<number, PipeSizeAnalysis>();

  for (const section of sections) {
    const items = lineItems[section.id] || [];
    const totals: BidTotals = {
      material_total: 0, labor_total: 0, equipment_total: 0,
      subcontractor_total: 0, direct_cost_total: 0,
    };
    let secLaborHours = 0;
    let secEquipmentHours = 0;
    let secPipeLF = 0;

    for (const item of items) {
      totals.material_total += item.material_total || 0;
      totals.labor_total += item.labor_total || 0;
      totals.equipment_total += item.equipment_total || 0;
      totals.subcontractor_total += item.subcontractor_cost || 0;
      totals.direct_cost_total += item.total_cost || 0;
      secLaborHours += item.labor_hours || 0;
      secEquipmentHours += item.equipment_hours || 0;

      const sizeIn = pipeSizeOf(item);
      if (sizeIn > 0) {
        const qty = pipeQtyLF(item);
        secPipeLF += qty;
        const agg = bySize.get(sizeIn) || { sizeIn, totalLF: 0, directCost: 0, directPerLF: 0 };
        agg.totalLF += qty;
        agg.directCost += item.total_cost || 0;
        bySize.set(sizeIn, agg);
      }
    }

    const params = sectionParams(section, job);
    const summary = computeBidSummary(totals, params);
    const sellTotal = summary.grandTotal;

    laborHours += secLaborHours;
    equipmentHours += secEquipmentHours;
    sectionRows.push({
      sectionId: section.id,
      name: section.name,
      isAlternate: section.is_alternate === 1,
      material: totals.material_total,
      labor: totals.labor_total,
      equipment: totals.equipment_total,
      sub: totals.subcontractor_total,
      directCost: totals.direct_cost_total,
      laborHours: secLaborHours,
      equipmentHours: secEquipmentHours,
      sellTotal,
      margin: sellTotal - totals.direct_cost_total,
      pipeLF: secPipeLF,
    });
  }

  const pipeSizes = Array.from(bySize.values())
    .map((p) => ({ ...p, directPerLF: p.totalLF > 0 ? p.directCost / p.totalLF : 0 }))
    .sort((a, b) => a.sizeIn - b.sizeIn);

  return {
    laborHours,
    crewDays: laborHours / CREW_DAY_HOURS,
    equipmentHours,
    sections: sectionRows,
    pipeSizes,
  };
}
