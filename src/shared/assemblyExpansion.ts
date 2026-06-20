import { calcCrewCostPerHour } from './crewCost';
import { roundHours } from './round';

/** Line-item payload shape expected by db:line-items:save (minus section/job/sort). */
export interface AssemblyLineItem {
  description: string;
  quantity: number;
  unit: string;
  materialId: number | null;
  materialUnitCost: number;
  crewTemplateId: number | null;
  productionRateId: number | null;
  laborHours: number;
  laborCostPerHour: number;
  equipmentId: number | null;
  equipmentCostPerHour: number;
  equipmentHours: number;
  subcontractorCost: number;
  notes: string;
}

/**
 * Expand an assembly (materials + optional labor/equipment components) into
 * bid line item payloads for a given quantity in the assembly's unit.
 *
 * `assembly` is the snake_case row from db:assemblies:list, including the
 * joined production_rate_per_hour / crew_name / equipment_* fields.
 * `crews` (from getCrewTemplates) provides burdened crew costs.
 */
export function buildAssemblyLineItems(
  assembly: any,
  qty: number,
  crews: any[],
  noteSuffix = '',
): AssemblyLineItem[] {
  const notes = `From assembly: ${assembly.name}${noteSuffix}`;
  const zeroCosts = {
    materialId: null as number | null, materialUnitCost: 0,
    crewTemplateId: null as number | null, productionRateId: null as number | null,
    laborHours: 0, laborCostPerHour: 0,
    equipmentId: null as number | null, equipmentCostPerHour: 0, equipmentHours: 0,
    subcontractorCost: 0,
  };

  const items: AssemblyLineItem[] = (assembly.items || []).map((item: any) => ({
    ...zeroCosts,
    description: item.material_name,
    quantity: item.quantity * qty,
    unit: item.material_unit,
    materialId: item.material_id,
    materialUnitCost: item.material_unit_cost,
    notes,
  }));

  // Labor component: hours from the production rate when one is linked,
  // burdened cost from the crew
  if (assembly.crew_template_id || assembly.production_rate_id) {
    const crew = crews.find((c: any) => c.id === assembly.crew_template_id);
    const costPerHour = crew ? calcCrewCostPerHour(crew) : 0;
    const ratePerHour = assembly.production_rate_per_hour || 0;
    items.push({
      ...zeroCosts,
      description: `${assembly.name} — Labor${assembly.crew_name ? ` (${assembly.crew_name})` : ''}`,
      quantity: qty,
      unit: assembly.unit,
      crewTemplateId: assembly.crew_template_id ?? null,
      productionRateId: assembly.production_rate_id ?? null,
      laborHours: ratePerHour > 0 ? roundHours(qty / ratePerHour) : 0,
      laborCostPerHour: costPerHour,
      notes,
    });
  }

  // Equipment component
  if (assembly.equipment_id) {
    items.push({
      ...zeroCosts,
      description: `${assembly.name} — Equipment${assembly.equipment_name ? ` (${assembly.equipment_name})` : ''}`,
      quantity: qty,
      unit: assembly.unit,
      equipmentId: assembly.equipment_id,
      equipmentCostPerHour: assembly.equipment_hourly_rate || 0,
      equipmentHours: roundHours(qty * (assembly.equipment_hours_per_unit || 0)),
      notes,
    });
  }

  return items;
}
