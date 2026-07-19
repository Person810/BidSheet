import { describe, expect, it } from 'vitest';
import { computeBidAnalysis, CREW_DAY_HOURS } from './bidAnalysis';
import type { BidJobParams } from '../../../shared/bidCalc';

const JOB: BidJobParams = {
  overhead_percent: 10,
  profit_percent: 10,
  bond_percent: 0,
  tax_percent: 0,
  escalation_percent: 0,
};

const section = (id: number, overrides: Partial<any> = {}) => ({
  id,
  name: `Section ${id}`,
  is_alternate: 0,
  overhead_percent_override: null,
  profit_percent_override: null,
  bond_percent_override: null,
  ...overrides,
});

const pipeLine = (overrides: Partial<any> = {}) => ({
  description: '8" PVC SDR-35',
  unit: 'LF',
  quantity: 100,
  material_total: 1000,
  labor_total: 500,
  equipment_total: 300,
  subcontractor_cost: 0,
  total_cost: 1800,
  labor_hours: 10,
  equipment_hours: 6,
  ...overrides,
});

describe('computeBidAnalysis', () => {
  it('totals effort across sections', () => {
    const out = computeBidAnalysis(
      [section(1), section(2)],
      { 1: [pipeLine()], 2: [pipeLine({ labor_hours: 14, equipment_hours: 2 })] },
      JOB,
    );
    expect(out.laborHours).toBe(24);
    expect(out.crewDays).toBeCloseTo(24 / CREW_DAY_HOURS);
    expect(out.equipmentHours).toBe(8);
  });

  it('computes sell and margin with the job markups', () => {
    const out = computeBidAnalysis([section(1)], { 1: [pipeLine()] }, JOB);
    const s = out.sections[0];
    expect(s.directCost).toBe(1800);
    // 10% OH + 10% profit on direct cost
    expect(s.sellTotal).toBeCloseTo(1800 * 1.2);
    expect(s.margin).toBeCloseTo(1800 * 0.2);
  });

  it('honors per-section markup overrides, like the real bid', () => {
    const out = computeBidAnalysis(
      [section(1, { overhead_percent_override: 0, profit_percent_override: 5 })],
      { 1: [pipeLine()] },
      JOB,
    );
    expect(out.sections[0].sellTotal).toBeCloseTo(1800 * 1.05);
  });

  it('rolls up $/LF by parsed pipe size across sections', () => {
    const out = computeBidAnalysis(
      [section(1), section(2)],
      {
        1: [
          pipeLine(), // 8", 100 LF, $1800
          pipeLine({ description: '12" RCP CL-III', quantity: 50, total_cost: 4000 }),
        ],
        2: [pipeLine({ quantity: 100, total_cost: 2200 })], // 8" again
      },
      JOB,
    );
    expect(out.pipeSizes.map((p) => p.sizeIn)).toEqual([8, 12]);
    const eight = out.pipeSizes[0];
    expect(eight.totalLF).toBe(200);
    expect(eight.directPerLF).toBeCloseTo((1800 + 2200) / 200);
    expect(out.pipeSizes[1].directPerLF).toBeCloseTo(4000 / 50);
  });

  it('rolls metric pipe lines (m unit, DN name) into the same canonical-LF buckets', () => {
    const out = computeBidAnalysis(
      [section(1)],
      {
        1: [
          pipeLine(), // 8", 100 LF, $1800
          // Metric emission of the same size pipe: DN200, 30.48 m = 100 LF
          pipeLine({ description: 'DN200 PVC SDR-35', unit: 'm', quantity: 30.48, total_cost: 2200 }),
          pipeLine({ description: 'DN300 RCP', unit: 'm', quantity: 15.24, total_cost: 4000 }),
        ],
      },
      JOB,
    );
    expect(out.pipeSizes.map((p) => p.sizeIn)).toEqual([8, 12]);
    const eight = out.pipeSizes[0];
    expect(eight.totalLF).toBeCloseTo(200);
    expect(eight.directPerLF).toBeCloseTo((1800 + 2200) / 200);
    expect(out.pipeSizes[1].totalLF).toBeCloseTo(50);
    expect(out.sections[0].pipeLF).toBeCloseTo(250);
  });

  it('excludes non-LF and unmarked lines from the pipe roll-up', () => {
    const out = computeBidAnalysis(
      [section(1)],
      {
        1: [
          pipeLine({ description: 'Trench Excavation', unit: 'CY' }),
          pipeLine({ description: 'Bedding Stone 8', unit: 'TON' }),
          pipeLine({ description: 'Dewatering', unit: 'LS' }),
          pipeLine({ description: 'Silt fence', unit: 'm' }), // metric but unmarked
        ],
      },
      JOB,
    );
    expect(out.pipeSizes).toEqual([]);
    expect(out.sections[0].pipeLF).toBe(0);
  });

  it('flags alternates and handles empty sections', () => {
    const out = computeBidAnalysis(
      [section(1, { is_alternate: 1 }), section(2)],
      { 1: [pipeLine()], 2: [] },
      JOB,
    );
    expect(out.sections[0].isAlternate).toBe(true);
    expect(out.sections[1].directCost).toBe(0);
    expect(out.sections[1].sellTotal).toBe(0);
  });
});
