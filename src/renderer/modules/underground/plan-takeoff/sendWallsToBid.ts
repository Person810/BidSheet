import type { TakeoffWall } from './types';
import { computeRunLengthLF, ftToInches, loadPageScaleMap } from './takeoffUtils';
import { computeWallQuantities } from './wallTakeoff';
import { buildAssemblyLineItems } from '../../../../shared/assemblyExpansion';
import { buildLineItemPayload } from '../../../../shared/lineItemPayload';

interface WallGroup {
  heightFt: number;
  thicknessIn: number;
  faces: number;
  rebarSpacingIn: number;
  materialId: number | null;
  assemblyId: number | null;
  totalLF: number;
  concreteCY: number;
  formSFCA: number;
  rebarLF: number;
  labels: string[];
}

/**
 * Groups measured wall runs by their config and creates bid line items in a
 * "Concrete Walls" section. Each group either expands a linked assembly (per
 * LF of wall) or emits concrete (CY) + formwork (SFCA) + rebar (LF) lines.
 * Walls on uncalibrated pages are skipped. Returns the line-item count.
 */
export async function sendWallsToBid(walls: TakeoffWall[], jobId: number): Promise<number> {
  const valid = walls.filter((w) => w.points.length >= 2);
  if (valid.length === 0) return 0;

  const scaleByPage = await loadPageScaleMap(jobId);

  const groups = new Map<string, WallGroup>();
  for (const wall of valid) {
    const scale = scaleByPage.get(wall.pdfPage);
    if (!scale) continue;
    const lengthLF = computeRunLengthLF(wall.points, scale);
    if (lengthLF <= 0) continue;
    const q = computeWallQuantities({
      lengthLF,
      heightFt: wall.heightFt,
      thicknessIn: wall.thicknessIn,
      faces: wall.faces,
      rebarSpacingIn: wall.rebarSpacingIn,
    });

    const key = `${ftToInches(wall.heightFt)}|${wall.thicknessIn}|${wall.faces}|${wall.rebarSpacingIn}|${wall.materialId ?? ''}|${wall.assemblyId ?? ''}`;
    const g = groups.get(key);
    if (g) {
      g.totalLF += q.lengthLF;
      g.concreteCY += q.concreteCY;
      g.formSFCA += q.formSFCA;
      g.rebarLF += q.rebarLF;
      if (wall.label) g.labels.push(wall.label);
    } else {
      groups.set(key, {
        heightFt: wall.heightFt,
        thicknessIn: wall.thicknessIn,
        faces: wall.faces,
        rebarSpacingIn: wall.rebarSpacingIn,
        materialId: wall.materialId,
        assemblyId: wall.assemblyId,
        totalLF: q.lengthLF,
        concreteCY: q.concreteCY,
        formSFCA: q.formSFCA,
        rebarLF: q.rebarLF,
        labels: wall.label ? [wall.label] : [],
      });
    }
  }
  if (groups.size === 0) return 0;

  const needsAssemblies = Array.from(groups.values()).some((g) => g.assemblyId != null);
  const [materials, assemblies, crews] = await Promise.all([
    window.api.getMaterials() as Promise<any[]>,
    needsAssemblies ? (window.api.getAssemblies() as Promise<any[]>) : Promise.resolve([]),
    needsAssemblies ? (window.api.getCrewTemplates() as Promise<any[]>) : Promise.resolve([]),
  ]);

  const sections: any[] = await window.api.getBidSections(jobId);
  const sectionResult = await window.api.saveBidSection({
    jobId,
    name: 'Concrete Walls',
    sortOrder: sections.length,
  });
  const sectionId = sectionResult.id;

  let sortOrder = 0;
  let createdCount = 0;
  const round1 = (n: number) => Math.round(n * 10) / 10;

  for (const g of groups.values()) {
    const dims = `${g.heightFt}' H x ${g.thicknessIn}" thk`;
    const labelSuffix = g.labels.length ? ` (${g.labels.join('; ')})` : ' (from plan takeoff)';

    // Assembly-linked walls expand per LF of wall — the contractor's wall
    // assembly encodes their own forming method and height.
    const assembly = g.assemblyId ? assemblies.find((a: any) => a.id === g.assemblyId) : null;
    if (assembly) {
      const payloads = buildAssemblyLineItems(assembly, round1(g.totalLF), crews, labelSuffix);
      for (const payload of payloads) {
        await window.api.saveBidLineItem({ sectionId, jobId, sortOrder: sortOrder++, ...payload });
      }
      createdCount += payloads.length;
      continue;
    }

    const mat = g.materialId ? materials.find((m: any) => m.id === g.materialId) : null;
    const noteBase = `From plan takeoff. ${round1(g.totalLF)} LF wall, ${dims}`;

    // Concrete volume line — apply catalog pricing only when the material is
    // priced per CY (anything else needs a manual unit the estimator controls).
    const concreteUnitCost = mat && mat.unit === 'CY' ? mat.default_unit_cost : 0;
    await window.api.saveBidLineItem(buildLineItemPayload({
      sectionId,
      jobId,
      description: `Concrete Wall (${dims})`,
      quantity: round1(g.concreteCY),
      unit: 'CY',
      sortOrder: sortOrder++,
      materialId: g.materialId,
      materialUnitCost: concreteUnitCost,
      notes: [noteBase, g.labels.join('; '),
        mat && mat.unit !== 'CY' ? `Material "${mat.name}" priced per ${mat.unit}, set unit cost manually` : '',
      ].filter(Boolean).join('. '),
    }));
    createdCount += 1;

    // Formwork contact area line
    await window.api.saveBidLineItem(buildLineItemPayload({
      sectionId,
      jobId,
      description: `Wall Formwork (${g.faces} face${g.faces !== 1 ? 's' : ''})`,
      quantity: round1(g.formSFCA),
      unit: 'SF',
      sortOrder: sortOrder++,
      notes: `${noteBase}. Square feet of contact area (SFCA)`,
    }));
    createdCount += 1;

    // Rebar grid line (only when reinforced)
    if (g.rebarLF > 0) {
      await window.api.saveBidLineItem(buildLineItemPayload({
        sectionId,
        jobId,
        description: `Wall Rebar (${g.rebarSpacingIn}" o.c. each way)`,
        quantity: round1(g.rebarLF),
        unit: 'LF',
        sortOrder: sortOrder++,
        notes: `${noteBase}. Grid over one wall face`,
      }));
      createdCount += 1;
    }
  }

  return createdCount;
}
