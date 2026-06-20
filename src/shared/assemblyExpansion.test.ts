import { describe, expect, it } from 'vitest';
import { buildAssemblyLineItems } from './assemblyExpansion';

// A crew whose burdened cost is 1×40×1.25 = $50/hr.
const crews = [{ id: 7, members: [{ quantity: 1, default_hourly_rate: 40, burden_multiplier: 1.25 }] }];

describe('buildAssemblyLineItems — materials', () => {
  it('scales each material quantity by the assembly quantity and carries cost/id', () => {
    const assembly = {
      name: 'Bedding',
      unit: 'LF',
      items: [
        { material_name: 'Sand', quantity: 2, material_unit: 'TON', material_id: 5, material_unit_cost: 3.5 },
      ],
    };
    const [mat] = buildAssemblyLineItems(assembly, 10, crews);
    expect(mat.description).toBe('Sand');
    expect(mat.quantity).toBe(20); // 2 per unit × 10 units
    expect(mat.unit).toBe('TON');
    expect(mat.materialId).toBe(5);
    expect(mat.materialUnitCost).toBe(3.5);
    // Material rows carry no labor/equipment cost.
    expect(mat.laborHours).toBe(0);
    expect(mat.equipmentHours).toBe(0);
  });

  it('returns no items for an assembly with no materials, labor, or equipment', () => {
    expect(buildAssemblyLineItems({ name: 'Empty', unit: 'EA', items: [] }, 5, crews)).toEqual([]);
  });

  it('appends a note suffix to every generated row', () => {
    const assembly = {
      name: 'Bedding',
      unit: 'LF',
      items: [{ material_name: 'Sand', quantity: 1, material_unit: 'TON', material_id: 1, material_unit_cost: 1 }],
    };
    const [mat] = buildAssemblyLineItems(assembly, 1, crews, ' (alt)');
    expect(mat.notes).toBe('From assembly: Bedding (alt)');
  });
});

describe('buildAssemblyLineItems — labor', () => {
  const laborAssembly = {
    name: 'Pipe',
    unit: 'LF',
    items: [],
    crew_template_id: 7,
    production_rate_id: 3,
    production_rate_per_hour: 100,
    crew_name: 'Crew A',
  };

  it('derives labor hours from the production rate and burdened crew cost', () => {
    const [labor] = buildAssemblyLineItems(laborAssembly, 400, crews);
    expect(labor.description).toBe('Pipe — Labor (Crew A)');
    expect(labor.quantity).toBe(400);
    expect(labor.crewTemplateId).toBe(7);
    expect(labor.productionRateId).toBe(3);
    expect(labor.laborHours).toBe(4); // 400 LF ÷ 100 LF/hr
    expect(labor.laborCostPerHour).toBe(50); // burdened crew cost
  });

  it('keeps small labor-hour quantities to 4 decimals instead of rounding to zero', () => {
    // 4 EA at 100/hr = 0.04 hr — a 1-decimal round would zero the labor cost.
    const [labor] = buildAssemblyLineItems(laborAssembly, 4, crews);
    expect(labor.laborHours).toBe(0.04);
  });

  it('yields zero labor hours when the production rate is zero', () => {
    const [labor] = buildAssemblyLineItems({ ...laborAssembly, production_rate_per_hour: 0 }, 100, crews);
    expect(labor.laborHours).toBe(0);
  });

  it('falls back to zero crew cost when the crew template is not found', () => {
    const [labor] = buildAssemblyLineItems({ ...laborAssembly, crew_template_id: 999 }, 100, crews);
    expect(labor.laborCostPerHour).toBe(0);
  });

  it('still emits a labor row when only a production rate (no crew) is linked', () => {
    const assembly = { name: 'Pipe', unit: 'LF', items: [], production_rate_id: 3, production_rate_per_hour: 50 };
    const items = buildAssemblyLineItems(assembly, 100, crews);
    expect(items).toHaveLength(1);
    expect(items[0].laborHours).toBe(2); // 100 ÷ 50
    expect(items[0].laborCostPerHour).toBe(0);
  });
});

describe('buildAssemblyLineItems — equipment', () => {
  it('scales equipment hours by hours-per-unit and carries the hourly rate', () => {
    const assembly = {
      name: 'Excavation',
      unit: 'CY',
      items: [],
      equipment_id: 9,
      equipment_name: 'Excavator',
      equipment_hourly_rate: 125,
      equipment_hours_per_unit: 0.5,
    };
    const [equip] = buildAssemblyLineItems(assembly, 10, crews);
    expect(equip.description).toBe('Excavation — Equipment (Excavator)');
    expect(equip.equipmentId).toBe(9);
    expect(equip.equipmentCostPerHour).toBe(125);
    expect(equip.equipmentHours).toBe(5); // 10 CY × 0.5 hr/CY
  });

  it('emits material, labor, and equipment rows together in order', () => {
    const assembly = {
      name: 'Full',
      unit: 'LF',
      items: [{ material_name: 'Pipe', quantity: 1, material_unit: 'LF', material_id: 1, material_unit_cost: 9 }],
      crew_template_id: 7,
      production_rate_id: 3,
      production_rate_per_hour: 100,
      equipment_id: 9,
      equipment_hourly_rate: 100,
      equipment_hours_per_unit: 0.25,
    };
    const items = buildAssemblyLineItems(assembly, 100, crews);
    expect(items).toHaveLength(3);
    expect(items[0].materialId).toBe(1); // material first
    expect(items[1].crewTemplateId).toBe(7); // labor second
    expect(items[2].equipmentId).toBe(9); // equipment last
  });
});
