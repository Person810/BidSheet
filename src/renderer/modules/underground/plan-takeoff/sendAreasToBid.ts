import type { TakeoffArea } from './types';
import { AREA_TYPE_LABELS } from './types';
import { computePolygonAreaSF, ftToInches, loadPageScaleMap } from './takeoffUtils';
import { cubicFeetToYards, squareFeetToYards } from '../../../../shared/constants/units';
import {
  bidLineQty, convertQty, formatQty, metricUnitPrice, roundTo,
  DEFAULT_UNIT_SYSTEM, type UnitSystem,
} from '../../../../shared/unitSystem';
import { buildAssemblyLineItems } from '../../../../shared/assemblyExpansion';
import { buildLineItemPayload } from '../../../../shared/lineItemPayload';
import { formatCurrency } from '../../../utils/format';

export interface AreaGroup {
  areaType: TakeoffArea['areaType'];
  depthFt: number;
  materialId: number | null;
  assemblyId: number | null;
  totalSF: number;
  totalSY: number;
  totalCY: number;
  labels: string[];
}

/**
 * Pick the area measure that matches a catalog/assembly unit. Unit-driven,
 * not system-driven — a per-SF assembly expands by SF whatever the active
 * setting is (it used to get the SY quantity, a 9x underbill).
 *
 * Returns null when the unit maps to NO area measure, exactly like
 * measureForUnit in sendWallsToBid. It used to fall through to SY, so an
 * 'Asphalt patch' assembly priced per TON was billed the square-YARD figure
 * as tons: 900 SF of 2" patch is ~8.3 tons and went out as 100, roughly a
 * 12x overstatement of mix, crew hours and paver hours, under a green
 * "Created N line items" toast. An empty unit still means the flow's own
 * billing unit; anything else this function doesn't recognise is a question
 * for the estimator, not a number to guess at.
 *
 * Exported for tests.
 */
export function areaMeasureForUnit(unit: string | null | undefined, g: AreaGroup): number | null {
  switch ((unit || '').trim().toUpperCase()) {
    case 'SF': return g.totalSF;
    case 'CY':
    case 'CYD': return g.totalCY;
    case 'M²': return convertQty(g.totalSY, 'sy', 'metric');
    case 'M³': return convertQty(g.totalCY, 'cy', 'metric');
    case 'SY':
    case '': return g.totalSY;
    default: return null;
  }
}

export interface SendAreasResult {
  /** Line items created. */
  created: number;
  /** Non-fatal skips the caller should surface to the user. */
  warnings: string[];
}

/**
 * Groups measured areas by surface type + depth + material and creates
 * bid line items (in SY) in a "Surface Restoration" bid section.
 * Areas on uncalibrated pages are skipped.
 * Returns the number of line items created.
 */
export async function sendAreasToBid(
  areas: TakeoffArea[],
  jobId: number,
  system: UnitSystem = DEFAULT_UNIT_SYSTEM,
): Promise<SendAreasResult> {
  // Earthwork regions (gradeMode set) are billed as cut/fill by
  // sendEarthworkToBid; including them here too would emit a phantom
  // surface-restoration line for each and double-bill the same polygon.
  const valid = areas.filter((a) => a.gradeMode == null && a.points.length >= 3);
  if (valid.length === 0) return { created: 0, warnings: [] };

  // Per-page scales — area math needs each polygon's own page calibration
  const scaleByPage = await loadPageScaleMap(jobId);

  const groups = new Map<string, AreaGroup>();
  for (const area of valid) {
    const scale = scaleByPage.get(area.pdfPage);
    if (!scale) continue;
    const sf = computePolygonAreaSF(area.points, scale);
    if (sf <= 0) continue;

    // Group key uses rounded inches so float noise in stored depths
    // can't split otherwise-identical groups
    const key = `${area.areaType}|${ftToInches(area.depthFt)}|${area.materialId ?? ''}|${area.assemblyId ?? ''}`;
    const g = groups.get(key);
    if (g) {
      g.totalSF += sf;
      g.totalSY += squareFeetToYards(sf);
      g.totalCY += cubicFeetToYards(sf * area.depthFt);
      if (area.label) g.labels.push(area.label);
    } else {
      groups.set(key, {
        areaType: area.areaType,
        depthFt: area.depthFt,
        materialId: area.materialId,
        assemblyId: area.assemblyId,
        totalSF: sf,
        totalSY: squareFeetToYards(sf),
        totalCY: cubicFeetToYards(sf * area.depthFt),
        labels: area.label ? [area.label] : [],
      });
    }
  }
  if (groups.size === 0) return { created: 0, warnings: [] };

  // Look up catalog unit costs, assemblies, and crews for expansion
  const needsAssemblies = Array.from(groups.values()).some((g) => g.assemblyId != null);
  const [materials, assemblies, crews] = await Promise.all([
    window.api.getMaterials() as Promise<any[]>,
    needsAssemblies ? (window.api.getAssemblies() as Promise<any[]>) : Promise.resolve([]),
    needsAssemblies ? (window.api.getCrewTemplates() as Promise<any[]>) : Promise.resolve([]),
  ]);

  // Drop any assembly-linked group whose unit has no area measure BEFORE
  // creating the section, so a send that turns out to be entirely
  // un-billable doesn't leave an empty "Surface Restoration" behind.
  const warnings: string[] = [];
  const sendable: AreaGroup[] = [];
  for (const g of groups.values()) {
    const assembly = g.assemblyId ? assemblies.find((a: any) => a.id === g.assemblyId) : null;
    if (assembly && areaMeasureForUnit(assembly.unit, g) == null) {
      const which = g.labels.length ? ` (${g.labels.join('; ')})` : '';
      warnings.push(
        `Skipped area${which}: assembly "${assembly.name}" is priced per ${assembly.unit}, which has no area measure (SF/SY/CY). Re-link it or add the line manually.`,
      );
      continue;
    }
    sendable.push(g);
  }
  if (sendable.length === 0) return { created: 0, warnings };

  // Get existing section count for sort_order
  const sections: any[] = await window.api.getBidSections(jobId);

  const sectionResult = await window.api.saveBidSection({
    jobId,
    name: 'Surface Restoration',
    sortOrder: sections.length,
  });
  const sectionId = sectionResult.id;

  let sortOrder = 0;
  let createdCount = 0;
  for (const g of sendable) {
    // Assembly-linked areas expand the full assembly (materials + labor +
    // equipment) scaled by the measured area in the assembly's own unit —
    // SF, SY, CY of the depth volume, or their metric spellings (unit-driven,
    // not system-driven: identities don't flip with the setting).
    const assembly = g.assemblyId ? assemblies.find((a: any) => a.id === g.assemblyId) : null;
    if (assembly) {
      // Non-null: the pre-filter above dropped every group whose unit has
      // no area measure.
      const qty = roundTo(areaMeasureForUnit(assembly.unit, g)!, 1);
      const noteSuffix = g.labels.length ? ` (${g.labels.join('; ')})` : ' (from plan takeoff)';
      const payloads = buildAssemblyLineItems(assembly, qty, crews, noteSuffix);
      for (const payload of payloads) {
        await window.api.saveBidLineItem({
          sectionId,
          jobId,
          sortOrder: sortOrder++,
          ...payload,
        });
      }
      createdCount += payloads.length;
      continue;
    }

    const mat = g.materialId ? materials.find((m: any) => m.id === g.materialId) : null;
    const depthIn = ftToInches(g.depthFt);
    const depthLabel = system === 'metric' ? formatQty(depthIn, 'in', system, 0) : `${depthIn}"`;
    const description =
      `${AREA_TYPE_LABELS[g.areaType]} Restoration` +
      (depthIn > 0 ? ` (${depthLabel} depth)` : '');
    // Only apply catalog pricing when the material is priced per the emitted
    // area unit (SY, or m² metric — an SY price converts exactly); TON/CY
    // materials need a manual conversion the estimator controls.
    const areaUnit = system === 'metric' ? 'm²' : 'SY';
    let unitCost = mat && mat.unit === areaUnit ? mat.default_unit_cost : 0;
    let priceNote =
      mat && mat.unit !== areaUnit ? `Material "${mat.name}" priced per ${mat.unit}, set unit cost manually` : '';
    if (system === 'metric' && mat && mat.unit === 'SY') {
      unitCost = metricUnitPrice(mat.default_unit_cost, 'sy');
      priceNote = `Material "${mat.name}" priced ${formatCurrency(mat.default_unit_cost)}/SY, using ${formatCurrency(unitCost)}/m²`;
    }
    const notes = [
      'From plan takeoff',
      g.totalCY > 0
        ? (system === 'metric' ? `${formatQty(g.totalCY, 'cy', system, 1)} volume` : `${g.totalCY.toFixed(1)} CY volume`)
        : '',
      g.labels.join('; '),
      priceNote,
    ].filter(Boolean).join('. ');

    const { quantity, unit } = bidLineQty(Math.round(g.totalSY * 10) / 10, 'sy', system);
    await window.api.saveBidLineItem(buildLineItemPayload({
      sectionId,
      jobId,
      description,
      quantity,
      unit,
      sortOrder: sortOrder++,
      materialId: g.materialId,
      materialUnitCost: unitCost,
      notes,
    }));
    createdCount += 1;
  }

  return { created: createdCount, warnings };
}
