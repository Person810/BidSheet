import { describe, it, expect } from 'vitest';
import { buildSellSchedule, roundUnitPrice, type UnitPriceRounding } from './sellSchedule';
import { computeBidSummaryFromSections, type SectionCostRow } from './bidCalc';

describe('roundUnitPrice', () => {
  it('rounds up to the cent without float noise pushing exact prices up', () => {
    expect(roundUnitPrice(27.1159, 'up_cent')).toBe(27.12);
    expect(roundUnitPrice(27.12, 'up_cent')).toBe(27.12); // 2711.9999… must not become 27.13
    expect(roundUnitPrice(0.1 + 0.2, 'up_cent')).toBe(0.3);
    expect(roundUnitPrice(18.301, 'up_cent')).toBe(18.31);
  });

  it('rounds to the nearest cent, halves up', () => {
    expect(roundUnitPrice(27.1149, 'nearest_cent')).toBe(27.11);
    expect(roundUnitPrice(2.675, 'nearest_cent')).toBe(2.68); // 267.49999… in binary
  });

  it('never returns negative zero (a $0 line printed as "-$0.00")', () => {
    for (const mode of ['up_cent', 'nearest_cent', 'up_dollar'] as const) {
      expect(Object.is(roundUnitPrice(0, mode), 0)).toBe(true);
      expect((roundUnitPrice(0, mode)).toLocaleString('en-US', { style: 'currency', currency: 'USD' })).toBe('$0.00');
    }
  });

  it('rounds up to whole dollars', () => {
    expect(roundUnitPrice(27.01, 'up_dollar')).toBe(28);
    expect(roundUnitPrice(27, 'up_dollar')).toBe(27);
  });
});

/** The walkthrough bid: pipe + manholes + sub quote, 12/8/1.5% markups, 7% tax, $4,500 indirects. */
function walkthroughJob() {
  const job = { overhead_percent: 12, profit_percent: 8, bond_percent: 1.5, tax_percent: 7, escalation_percent: 0, freight: 0 };
  const sections = [
    { id: 1, name: 'Sanitary Sewer', is_alternate: 0 },
    { id: 2, name: 'Surface Restoration', is_alternate: 1 },
    { id: 3, name: 'Subcontractors', is_alternate: 0 },
  ];
  const itemsBySection = {
    1: [
      { id: 1, quantity: 500, material_total: 3750, total_cost: 9152 },
      { id: 2, quantity: 2, material_total: 3200, total_cost: 3200 },
      { id: 3, quantity: 8, material_total: 144, total_cost: 144 },
    ],
    2: [{ id: 4, quantity: 220, material_total: 0, total_cost: 9900 }],
    3: [{ id: 5, quantity: 1, material_total: 0, total_cost: 8750 }],
  };
  return { job, sections, itemsBySection, indirectTotal: 4500, freightTaxable: false };
}

const summaryTotal = (w: ReturnType<typeof walkthroughJob>) => {
  const rows: SectionCostRow[] = w.sections.map((s) => {
    const items = w.itemsBySection[s.id as 1 | 2 | 3];
    const material = items.reduce((t, i) => t + i.material_total, 0);
    const direct = items.reduce((t, i) => t + i.total_cost, 0);
    return {
      section_id: s.id, name: s.name, is_alternate: s.is_alternate,
      overhead_percent_override: null, profit_percent_override: null, bond_percent_override: null,
      material_total: material, labor_total: 0, equipment_total: 0,
      subcontractor_total: direct - material, direct_cost_total: direct,
    };
  });
  return computeBidSummaryFromSections(rows, w.job, w.indirectTotal, w.freightTaxable);
};

describe('buildSellSchedule', () => {
  it('the unrounded estimate equals the bid summary total', () => {
    const w = walkthroughJob();
    const s = buildSellSchedule({ ...w, rounding: 'up_cent' });
    expect(s.estimateBaseTotal).toBeCloseTo(summaryTotal(w).grandTotal, 2);
  });

  it.each<UnitPriceRounding>(['up_cent', 'nearest_cent', 'up_dollar'])(
    'every printed line checks and the total is the sum of extensions (%s)',
    (rounding) => {
      const s = buildSellSchedule({ ...walkthroughJob(), rounding });
      let sum = 0;
      for (const sec of [...s.base]) {
        let sub = 0;
        for (const l of sec.lines) {
          expect(l.extension).toBeCloseTo(l.unitPrice * l.quantity, 6);
          sub += l.extension;
        }
        expect(sec.subtotal).toBeCloseTo(sub, 6);
        sum += sec.subtotal;
      }
      expect(s.baseTotal).toBeCloseTo(sum, 6);
    },
  );

  it('rounding up never bids below the estimate; nearest stays within a cent per unit', () => {
    const up = buildSellSchedule({ ...walkthroughJob(), rounding: 'up_cent' });
    expect(up.baseTotal).toBeGreaterThanOrEqual(up.estimateBaseTotal);
    const unitsInBase = 500 + 2 + 8 + 1;
    expect(up.baseTotal - up.estimateBaseTotal).toBeLessThanOrEqual(unitsInBase * 0.01);

    const near = buildSellSchedule({ ...walkthroughJob(), rounding: 'nearest_cent' });
    expect(Math.abs(near.baseTotal - near.estimateBaseTotal)).toBeLessThanOrEqual(unitsInBase * 0.005 + 0.01);

    const dollars = buildSellSchedule({ ...walkthroughJob(), rounding: 'up_dollar' });
    expect(dollars.baseTotal).toBeGreaterThanOrEqual(dollars.estimateBaseTotal);
    for (const l of dollars.base.flatMap((s) => s.lines)) expect(Number.isInteger(l.unitPrice)).toBe(true);
  });

  it('prices the 8" pipe at its sell price, not its cost', () => {
    const s = buildSellSchedule({ ...walkthroughJob(), rounding: 'up_cent' });
    const pipe = s.base[0].lines[0];
    expect(pipe.unitPrice).toBeGreaterThan(9152 / 500); // cost is $18.30/LF
    // Sell = direct × (1 + 12% + 8% + 1.5%) + material × 7% tax, then the
    // $4,500 × 1.215 indirect pool spread pro rata over the base bid.
    const lineSell = (direct: number, material: number) => direct * 1.215 + material * 0.07;
    const baseSell = lineSell(9152, 3750) + lineSell(3200, 3200) + lineSell(144, 144) + lineSell(8750, 0);
    const factor = 1 + (4500 * 1.215) / baseSell;
    expect(pipe.unitPrice).toBe(Math.ceil((lineSell(9152, 3750) * factor / 500) * 100) / 100);
  });

  it('keeps alternates out of the base and free of the indirect spread', () => {
    const s = buildSellSchedule({ ...walkthroughJob(), rounding: 'up_cent' });
    expect(s.alternates.map((a) => a.section.name)).toEqual(['Surface Restoration']);
    // 9900 × 1.215 = 12,028.50 over 220 SY = 54.675 → 54.68 rounded up
    expect(s.alternates[0].lines[0].unitPrice).toBe(54.68);
  });

  it('prints indirects as a lump sum when there are no base lines to spread them into', () => {
    const s = buildSellSchedule({
      job: { overhead_percent: 10, profit_percent: 0 }, sections: [{ id: 1, name: 'Empty' }],
      itemsBySection: { 1: [] }, indirectTotal: 1000, freightTaxable: false, rounding: 'up_cent',
    });
    expect(s.generalConditions).toBe(1100);
    expect(s.baseTotal).toBe(1100);
  });
});
