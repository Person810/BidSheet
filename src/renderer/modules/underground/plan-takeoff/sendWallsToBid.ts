import type { TakeoffWall } from './types';
import { computeRunLengthLF, ftToInches, loadPageScaleMap } from './takeoffUtils';
import { computeWallQuantities } from './wallTakeoff';
import { squareFeetToYards } from '../../../../shared/constants/units';
import {
  bidLineQty, convertQty, formatQty, DEFAULT_UNIT_SYSTEM, type UnitSystem,
} from '../../../../shared/unitSystem';
import { buildAssemblyLineItems } from '../../../../shared/assemblyExpansion';
import { buildLineItemPayload } from '../../../../shared/lineItemPayload';

export interface WallGroup {
  heightFt: number;
  thicknessIn: number;
  faces: number;
  memberSpacingIn: number;
  materialId: number | null;
  assemblyId: number | null;
  totalLF: number;
  surfaceSF: number;
  volumeCY: number;
  memberLF: number;
  labels: string[];
}

/**
 * Pick the quantity that matches a catalog/assembly unit. A missing/blank
 * unit defaults to LF. Metric units map to the same wall measures converted
 * (unit-driven, not system-driven: a material priced per m² bills its m²
 * regardless of the active setting). Returns null for units no wall measure
 * maps to (TON, EA, GAL, ...) — billing the LF quantity as such a unit would
 * be wildly wrong, so callers must skip those and tell the user.
 * Exported for tests.
 */
export function measureForUnit(unit: string | null | undefined, g: WallGroup): number | null {
  switch ((unit || '').trim().toUpperCase()) {
    case 'SF': return g.surfaceSF;
    case 'SY': return squareFeetToYards(g.surfaceSF);
    case 'CY':
    case 'CYD': return g.volumeCY;
    case 'M': return convertQty(g.totalLF, 'lf', 'metric');
    case 'M²': return convertQty(g.surfaceSF, 'sf', 'metric');
    case 'M³': return convertQty(g.volumeCY, 'cy', 'metric');
    case 'LF':
    case '': return g.totalLF;
    default: return null;
  }
}

export interface SendWallsResult {
  /** Line items created. */
  created: number;
  /** Non-fatal skips the caller should surface to the user. */
  warnings: string[];
}

/**
 * Groups measured wall runs by their config and creates bid line items in a
 * "Walls" section. Trade-agnostic: a linked assembly expands by the measure
 * matching its unit, a linked material bills in its own unit, and an unlinked
 * wall produces a length line (with surface area + volume noted) plus a
 * vertical-members line when a member spacing is set. Walls on uncalibrated
 * pages are skipped. Walls linked to a material/assembly in a unit no wall
 * measure maps to are skipped with a warning instead of mis-billing the LF
 * quantity as that unit. Returns the line-item count plus any warnings.
 */
export async function sendWallsToBid(
  walls: TakeoffWall[],
  jobId: number,
  system: UnitSystem = DEFAULT_UNIT_SYSTEM,
): Promise<SendWallsResult> {
  const valid = walls.filter((w) => w.points.length >= 2);
  if (valid.length === 0) return { created: 0, warnings: [] };

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
      memberSpacingIn: wall.memberSpacingIn,
    });

    const key = `${ftToInches(wall.heightFt)}|${wall.thicknessIn}|${wall.faces}|${wall.memberSpacingIn}|${wall.materialId ?? ''}|${wall.assemblyId ?? ''}`;
    const g = groups.get(key);
    if (g) {
      g.totalLF += q.lengthLF;
      g.surfaceSF += q.surfaceSF;
      g.volumeCY += q.volumeCY;
      g.memberLF += q.memberLF;
      if (wall.label) g.labels.push(wall.label);
    } else {
      groups.set(key, {
        heightFt: wall.heightFt,
        thicknessIn: wall.thicknessIn,
        faces: wall.faces,
        memberSpacingIn: wall.memberSpacingIn,
        materialId: wall.materialId,
        assemblyId: wall.assemblyId,
        totalLF: q.lengthLF,
        surfaceSF: q.surfaceSF,
        volumeCY: q.volumeCY,
        memberLF: q.memberLF,
        labels: wall.label ? [wall.label] : [],
      });
    }
  }
  if (groups.size === 0) return { created: 0, warnings: [] };

  const needsAssemblies = Array.from(groups.values()).some((g) => g.assemblyId != null);
  const [materials, assemblies, crews] = await Promise.all([
    window.api.getMaterials() as Promise<any[]>,
    needsAssemblies ? (window.api.getAssemblies() as Promise<any[]>) : Promise.resolve([]),
    needsAssemblies ? (window.api.getCrewTemplates() as Promise<any[]>) : Promise.resolve([]),
  ]);

  // Drop groups whose linked material/assembly is priced in a unit no wall
  // measure maps to — billing the LF quantity as TON/EA/GAL would be wildly
  // wrong. Each skip is surfaced so the user can re-link or add the line
  // manually. Done before creating the section so an all-skip send doesn't
  // leave an empty "Walls" section behind.
  const warnings: string[] = [];
  const sendable: WallGroup[] = [];
  for (const g of groups.values()) {
    const assembly = g.assemblyId ? assemblies.find((a: any) => a.id === g.assemblyId) : null;
    const mat = !assembly && g.materialId ? materials.find((m: any) => m.id === g.materialId) : null;
    const linked = assembly ?? mat;
    if (linked && measureForUnit(linked.unit, g) == null) {
      const what = assembly ? `assembly "${assembly.name}"` : `material "${linked.name}"`;
      const which = g.labels.length ? ` (${g.labels.join('; ')})` : '';
      warnings.push(
        `Skipped wall${which}: ${what} is priced per ${linked.unit}, which has no wall measure (LF/SF/SY/CY). Re-link it or add the line manually.`,
      );
      continue;
    }
    sendable.push(g);
  }
  if (sendable.length === 0) return { created: 0, warnings };

  const sections: any[] = await window.api.getBidSections(jobId);
  const sectionResult = await window.api.saveBidSection({
    jobId,
    name: 'Walls',
    sortOrder: sections.length,
  });
  const sectionId = sectionResult.id;

  let sortOrder = 0;
  let createdCount = 0;
  const round1 = (n: number) => Math.round(n * 10) / 10;

  const metric = system === 'metric';
  for (const g of sendable) {
    const dims = metric
      ? `${formatQty(g.heightFt, 'ft', system)} H x ${formatQty(g.thicknessIn, 'in', system, 0)} thk`
      : `${g.heightFt}' H x ${g.thicknessIn}" thk`;
    const labelSuffix = g.labels.length ? ` (${g.labels.join('; ')})` : ' (from plan takeoff)';

    // Assembly-linked walls expand by the measure matching the assembly's
    // unit — LF of wall, SF of surface, or CY of volume — so the contractor's
    // own wall assembly (concrete, framed, masonry) drives the breakdown.
    const assembly = g.assemblyId ? assemblies.find((a: any) => a.id === g.assemblyId) : null;
    if (assembly) {
      // Non-null: unhandled units were filtered into `warnings` above.
      const qty = round1(measureForUnit(assembly.unit, g)!);
      const payloads = buildAssemblyLineItems(assembly, qty, crews, labelSuffix);
      for (const payload of payloads) {
        await window.api.saveBidLineItem({ sectionId, jobId, sortOrder: sortOrder++, ...payload });
      }
      createdCount += payloads.length;
      continue;
    }

    const noteParts = [
      'From plan takeoff',
      metric ? `${formatQty(g.totalLF, 'lf', system, 1)} wall, ${dims}` : `${round1(g.totalLF)} LF wall, ${dims}`,
      g.surfaceSF > 0
        ? `${metric ? formatQty(g.surfaceSF, 'sf', system, 0) : `${Math.round(g.surfaceSF)} SF`} surface (${g.faces} face${g.faces !== 1 ? 's' : ''})`
        : '',
      g.volumeCY > 0 ? `${metric ? formatQty(g.volumeCY, 'cy', system, 2) : `${g.volumeCY.toFixed(2)} CY`} volume` : '',
      g.memberLF > 0
        ? `${metric ? formatQty(g.memberLF, 'lf', system, 1) : `${round1(g.memberLF)} LF`} vertical members`
        : '',
      g.labels.join('; '),
    ].filter(Boolean);

    // Material-linked walls bill in the material's own unit.
    const mat = g.materialId ? materials.find((m: any) => m.id === g.materialId) : null;
    if (mat) {
      // Non-null: unhandled units were filtered into `warnings` above.
      const qty = round1(measureForUnit(mat.unit, g)!);
      await window.api.saveBidLineItem(buildLineItemPayload({
        sectionId,
        jobId,
        description: `Wall — ${mat.name} (${dims})`,
        quantity: qty,
        unit: mat.unit,
        sortOrder: sortOrder++,
        materialId: g.materialId,
        materialUnitCost: mat.default_unit_cost ?? 0,
        notes: noteParts.join('. '),
      }));
      createdCount += 1;
    } else {
      // No link: a generic length line carrying the other measures in notes.
      const wallLine = bidLineQty(round1(g.totalLF), 'lf', system);
      await window.api.saveBidLineItem(buildLineItemPayload({
        sectionId,
        jobId,
        description: `Wall (${dims})`,
        quantity: wallLine.quantity,
        unit: wallLine.unit,
        sortOrder: sortOrder++,
        notes: noteParts.join('. '),
      }));
      createdCount += 1;
    }

    // Vertical members (studs / bars / posts) as their own linear line.
    if (g.memberLF > 0) {
      const spacing = metric ? formatQty(g.memberSpacingIn, 'in', system, 0) : `${g.memberSpacingIn}"`;
      const memberLine = bidLineQty(round1(g.memberLF), 'lf', system);
      await window.api.saveBidLineItem(buildLineItemPayload({
        sectionId,
        jobId,
        description: `Wall vertical members (${spacing} o.c.)`,
        quantity: memberLine.quantity,
        unit: memberLine.unit,
        sortOrder: sortOrder++,
        notes: `From plan takeoff. ${dims}`,
      }));
      createdCount += 1;
    }
  }

  return { created: createdCount, warnings };
}
