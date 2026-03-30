import { calculateTrench, type TrenchInput } from '../trenchCalc';
import type { TakeoffRun, PdfPoint } from './types';

function computeRunLengthLF(points: PdfPoint[], scalePxPerFt: number): number {
  let totalPx = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    totalPx += Math.sqrt(dx * dx + dy * dy);
  }
  return totalPx / scalePxPerFt;
}

function buildTrenchInput(run: TakeoffRun, runLengthLF: number): TrenchInput {
  return {
    pipeSizeIn: run.pipeSizeIn,
    pipeMaterial: run.pipeMaterial,
    startDepthFt: run.startDepthFt,
    gradePct: run.gradePct,
    runLengthLF,
    trenchWidthFt: run.trenchWidthFt,
    benchWidthFt: run.benchWidthFt,
    beddingDepthFt: run.beddingDepthFt,
    backfillType: run.backfillType,
  };
}

interface AggEntry {
  qty: number;
  materialId: number | null;
  name: string;
  labels: string[];
}

interface AggEntryWithUnit extends AggEntry {
  unit: string;
}

/**
 * Converts takeoff runs into bid line items, following the same pattern as
 * handleConvertToBid in JobDetail.tsx.
 * Returns the number of line items created.
 */
export async function sendRunsToBid(
  runs: TakeoffRun[],
  jobId: number,
  scalePxPerFt: number,
): Promise<number> {
  const completedRuns = runs.filter((r) => r.points.length >= 2);
  if (completedRuns.length === 0) return 0;

  const materials: any[] = await window.api.getMaterials();

  const tracerMat = materials.find((m: any) => m.name.toLowerCase().includes('tracer wire'));
  const tapeMat = materials.find((m: any) => m.name.toLowerCase().includes('warning tape'));

  // Aggregate quantities
  const pipeByKey = new Map<string, AggEntry>();
  let totalExcavationCY = 0;
  const beddingByKey = new Map<string, AggEntryWithUnit>();
  const backfillByKey = new Map<string, AggEntryWithUnit>();
  let totalTracerLF = 0;
  let totalTapeLF = 0;

  for (const run of completedRuns) {
    const runLengthLF = computeRunLengthLF(run.points, scalePxPerFt);
    if (runLengthLF <= 0) continue;
    const result = calculateTrench(buildTrenchInput(run, runLengthLF));
    const label = run.label || 'Untitled';

    // Pipe
    const pipeKey = run.pipeMaterialId != null ? String(run.pipeMaterialId) : (run.pipeMaterial || 'Pipe');
    const pipeEntry = pipeByKey.get(pipeKey);
    if (pipeEntry) {
      pipeEntry.qty += result.pipeLF;
      pipeEntry.labels.push(label);
    } else {
      pipeByKey.set(pipeKey, { qty: result.pipeLF, materialId: run.pipeMaterialId, name: run.pipeMaterial || 'Pipe', labels: [label] });
    }

    totalExcavationCY += result.excavationCY;

    // Bedding
    const bedKey = run.beddingMaterialId != null ? String(run.beddingMaterialId) : (run.beddingType || 'Bedding');
    const bedEntry = beddingByKey.get(bedKey);
    const bedMat = run.beddingMaterialId ? materials.find((m: any) => m.id === run.beddingMaterialId) : null;
    if (bedEntry) {
      bedEntry.qty += result.beddingCY;
      bedEntry.labels.push(label);
    } else {
      beddingByKey.set(bedKey, { qty: result.beddingCY, materialId: run.beddingMaterialId, name: run.beddingType || 'Bedding', unit: bedMat?.unit || 'CY', labels: [label] });
    }

    // Backfill
    const bfKey = run.backfillMaterialId != null ? String(run.backfillMaterialId) : (run.backfillType || 'Backfill');
    const bfEntry = backfillByKey.get(bfKey);
    const bfMat = run.backfillMaterialId ? materials.find((m: any) => m.id === run.backfillMaterialId) : null;
    if (bfEntry) {
      bfEntry.qty += result.backfillCY;
      bfEntry.labels.push(label);
    } else {
      backfillByKey.set(bfKey, { qty: result.backfillCY, materialId: run.backfillMaterialId, name: run.backfillType || 'Backfill', unit: bfMat?.unit || 'CY', labels: [label] });
    }

    totalTracerLF += result.tracerWireLF;
    totalTapeLF += result.warningTapeLF;
  }

  const allLabels = completedRuns.map((r) => r.label || 'Untitled').join(', ');
  const takeoffNote = `From plan takeoff: ${allLabels}`;

  // Get existing section count for sort_order
  const sections: any[] = await window.api.getBidSections(jobId);

  // Create bid section
  const sectionResult = await window.api.saveBidSection({
    jobId,
    name: 'Plan Takeoff',
    sortOrder: sections.length,
  });
  const sectionId = Number(sectionResult.lastInsertRowid);
  let sortOrder = 0;
  let itemCount = 0;

  const saveItem = async (opts: { description: string; quantity: number; unit: string; materialId: number | null; materialUnitCost: number; notes: string }) => {
    await window.api.saveBidLineItem({
      sectionId, jobId, sortOrder: sortOrder++,
      description: opts.description, quantity: opts.quantity, unit: opts.unit,
      materialId: opts.materialId, materialUnitCost: opts.materialUnitCost,
      crewTemplateId: null, productionRateId: null,
      laborHours: 0, laborCostPerHour: 0,
      equipmentId: null, equipmentCostPerHour: 0, equipmentHours: 0,
      subcontractorCost: 0, notes: opts.notes,
    });
    itemCount++;
  };

  // Pipe line items
  for (const entry of pipeByKey.values()) {
    const mat = entry.materialId ? materials.find((m: any) => m.id === entry.materialId) : null;
    await saveItem({
      description: entry.name, quantity: entry.qty, unit: 'LF',
      materialId: entry.materialId, materialUnitCost: mat?.default_unit_cost || 0,
      notes: takeoffNote,
    });
  }

  // Excavation
  await saveItem({
    description: 'Excavation', quantity: totalExcavationCY, unit: 'CY',
    materialId: null, materialUnitCost: 0, notes: takeoffNote,
  });

  // Bedding
  for (const entry of beddingByKey.values()) {
    const mat = entry.materialId ? materials.find((m: any) => m.id === entry.materialId) : null;
    const unitMismatch = mat && mat.unit !== 'CY' && mat.unit !== 'CYD';
    await saveItem({
      description: entry.name, quantity: entry.qty, unit: 'CY',
      materialId: entry.materialId, materialUnitCost: 0,
      notes: unitMismatch ? `${takeoffNote} | Catalog unit is ${mat.unit} -- adjust pricing manually` : takeoffNote,
    });
  }

  // Backfill
  for (const entry of backfillByKey.values()) {
    const mat = entry.materialId ? materials.find((m: any) => m.id === entry.materialId) : null;
    const unitMismatch = mat && mat.unit !== 'CY' && mat.unit !== 'CYD';
    await saveItem({
      description: entry.name, quantity: entry.qty, unit: 'CY',
      materialId: entry.materialId, materialUnitCost: 0,
      notes: unitMismatch ? `${takeoffNote} | Catalog unit is ${mat.unit} -- adjust pricing manually` : takeoffNote,
    });
  }

  // Tracer Wire
  await saveItem({
    description: tracerMat?.name || 'Tracer Wire', quantity: totalTracerLF, unit: 'LF',
    materialId: tracerMat?.id || null, materialUnitCost: tracerMat?.default_unit_cost || 0,
    notes: takeoffNote,
  });

  // Warning Tape
  await saveItem({
    description: tapeMat?.name || 'Warning Tape', quantity: totalTapeLF, unit: 'LF',
    materialId: tapeMat?.id || null, materialUnitCost: tapeMat?.default_unit_cost || 0,
    notes: takeoffNote,
  });

  return itemCount;
}
