import type { TakeoffArea } from './types';
import { AREA_TYPE_LABELS } from './types';
import { computePolygonAreaSF, ftToInches, loadPageScaleMap } from './takeoffUtils';
import { buildAssemblyLineItems } from '../../../../shared/assemblyExpansion';
import { buildLineItemPayload } from '../../../../shared/lineItemPayload';

interface AreaGroup {
  areaType: TakeoffArea['areaType'];
  depthFt: number;
  materialId: number | null;
  assemblyId: number | null;
  totalSY: number;
  totalCY: number;
  labels: string[];
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
): Promise<number> {
  const valid = areas.filter((a) => a.points.length >= 3);
  if (valid.length === 0) return 0;

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
      g.totalSY += sf / 9;
      g.totalCY += (sf * area.depthFt) / 27;
      if (area.label) g.labels.push(area.label);
    } else {
      groups.set(key, {
        areaType: area.areaType,
        depthFt: area.depthFt,
        materialId: area.materialId,
        assemblyId: area.assemblyId,
        totalSY: sf / 9,
        totalCY: (sf * area.depthFt) / 27,
        labels: area.label ? [area.label] : [],
      });
    }
  }
  if (groups.size === 0) return 0;

  // Look up catalog unit costs, assemblies, and crews for expansion
  const needsAssemblies = Array.from(groups.values()).some((g) => g.assemblyId != null);
  const [materials, assemblies, crews] = await Promise.all([
    window.api.getMaterials() as Promise<any[]>,
    needsAssemblies ? (window.api.getAssemblies() as Promise<any[]>) : Promise.resolve([]),
    needsAssemblies ? (window.api.getCrewTemplates() as Promise<any[]>) : Promise.resolve([]),
  ]);

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
  for (const g of groups.values()) {
    // Assembly-linked areas expand the full assembly (materials + labor +
    // equipment) scaled by measured SY
    const assembly = g.assemblyId ? assemblies.find((a: any) => a.id === g.assemblyId) : null;
    if (assembly) {
      const qtySY = Math.round(g.totalSY * 10) / 10;
      const noteSuffix = g.labels.length ? ` — ${g.labels.join('; ')}` : ' — from plan takeoff';
      const payloads = buildAssemblyLineItems(assembly, qtySY, crews, noteSuffix);
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
    const description =
      `${AREA_TYPE_LABELS[g.areaType]} Restoration` +
      (depthIn > 0 ? ` (${depthIn}" depth)` : '');
    // Only apply catalog pricing when the material is actually priced per SY;
    // TON/CY-priced materials need a manual conversion the estimator controls.
    const unitCost = mat && mat.unit === 'SY' ? mat.default_unit_cost : 0;
    const notes = [
      'From plan takeoff',
      g.totalCY > 0 ? `${g.totalCY.toFixed(1)} CY volume` : '',
      g.labels.join('; '),
      mat && mat.unit !== 'SY' ? `Material "${mat.name}" priced per ${mat.unit} — set unit cost manually` : '',
    ].filter(Boolean).join(' — ');

    await window.api.saveBidLineItem(buildLineItemPayload({
      sectionId,
      jobId,
      description,
      quantity: Math.round(g.totalSY * 10) / 10,
      unit: 'SY',
      sortOrder: sortOrder++,
      materialId: g.materialId,
      materialUnitCost: unitCost,
      notes,
    }));
    createdCount += 1;
  }

  return createdCount;
}
