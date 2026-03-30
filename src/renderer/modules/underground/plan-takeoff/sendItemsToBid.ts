import type { TakeoffItem } from './types';

interface MaterialGroup {
  materialId: number | null;
  materialName: string;
  totalQty: number;
}

/**
 * Groups takeoff items by material and creates bid line items
 * in a "Fittings & Structures" bid section.
 * Returns the number of line items created.
 */
export async function sendItemsToBid(
  items: TakeoffItem[],
  jobId: number,
): Promise<number> {
  if (items.length === 0) return 0;

  // Group by material
  const groups = new Map<string, MaterialGroup>();
  for (const item of items) {
    const key = item.materialId != null ? String(item.materialId) : item.materialName;
    const g = groups.get(key);
    if (g) {
      g.totalQty += item.quantity;
    } else {
      groups.set(key, {
        materialId: item.materialId,
        materialName: item.materialName,
        totalQty: item.quantity,
      });
    }
  }

  // Look up catalog unit costs
  const materials: any[] = await window.api.getMaterials();

  // Get existing section count for sort_order
  const sections: any[] = await window.api.getBidSections(jobId);

  // Create bid section
  const sectionResult = await window.api.saveBidSection({
    jobId,
    name: 'Fittings & Structures',
    sortOrder: sections.length,
  });
  const sectionId = Number(sectionResult.lastInsertRowid);

  let sortOrder = 0;
  for (const g of groups.values()) {
    const mat = g.materialId ? materials.find((m: any) => m.id === g.materialId) : null;
    await window.api.saveBidLineItem({
      sectionId,
      jobId,
      description: g.materialName,
      quantity: g.totalQty,
      unit: mat?.unit || 'EA',
      sortOrder: sortOrder++,
      materialId: g.materialId,
      materialUnitCost: mat?.default_unit_cost || 0,
      crewTemplateId: null,
      productionRateId: null,
      laborHours: 0,
      laborCostPerHour: 0,
      equipmentId: null,
      equipmentCostPerHour: 0,
      equipmentHours: 0,
      subcontractorCost: 0,
      notes: 'From plan takeoff',
    });
  }

  return groups.size;
}
