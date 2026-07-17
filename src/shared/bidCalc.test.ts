import { describe, expect, it } from 'vitest';
import {
  computeBidSummary,
  computeBidSummaryFromSections,
  type BidJobParams,
  type BidTotals,
  type SectionCostRow,
} from './bidCalc';

const totals = (overrides: Partial<BidTotals> = {}): BidTotals => ({
  material_total: 0,
  labor_total: 0,
  equipment_total: 0,
  subcontractor_total: 0,
  direct_cost_total: 0,
  ...overrides,
});

const section = (overrides: Partial<SectionCostRow> = {}): SectionCostRow => ({
  section_id: 1,
  name: 'Section',
  is_alternate: 0,
  overhead_percent_override: null,
  profit_percent_override: null,
  bond_percent_override: null,
  ...totals(),
  ...overrides,
});

describe('computeBidSummary', () => {
  it('applies overhead, profit, and bond to direct cost, and tax to materials only', () => {
    const job: BidJobParams = {
      overhead_percent: 10,
      profit_percent: 5,
      bond_percent: 1,
      tax_percent: 7,
    };
    const s = computeBidSummary(
      totals({ material_total: 1000, labor_total: 500, equipment_total: 300, subcontractor_total: 200, direct_cost_total: 2000 }),
      job,
    );

    expect(s.escalation).toBe(0);
    expect(s.overhead).toBeCloseTo(200);
    expect(s.profit).toBeCloseTo(100);
    expect(s.bond).toBeCloseTo(20);
    expect(s.tax).toBeCloseTo(70); // 7% of materials, not of direct cost
    expect(s.grandTotal).toBeCloseTo(2000 + 200 + 100 + 20 + 70);
  });

  it('treats escalation as extra material cost: marked up and taxed', () => {
    const job: BidJobParams = {
      overhead_percent: 10,
      profit_percent: 5,
      bond_percent: 1,
      tax_percent: 7,
      escalation_percent: 3,
    };
    const s = computeBidSummary(
      totals({ material_total: 1000, labor_total: 500, equipment_total: 300, subcontractor_total: 200, direct_cost_total: 2000 }),
      job,
    );

    expect(s.escalation).toBeCloseTo(30); // 3% of materials
    const escalatedDirect = 2030;
    expect(s.overhead).toBeCloseTo(escalatedDirect * 0.10);
    expect(s.profit).toBeCloseTo(escalatedDirect * 0.05);
    expect(s.bond).toBeCloseTo(escalatedDirect * 0.01);
    expect(s.tax).toBeCloseTo(1030 * 0.07); // tax base includes escalation
    expect(s.grandTotal).toBeCloseTo(2030 + 203 + 101.5 + 20.3 + 72.1);
  });

  it('treats missing bond, tax, and escalation as zero', () => {
    const s = computeBidSummary(
      totals({ material_total: 100, direct_cost_total: 100 }),
      { overhead_percent: 10, profit_percent: 10, bond_percent: null, tax_percent: null },
    );
    expect(s.bond).toBe(0);
    expect(s.tax).toBe(0);
    expect(s.escalation).toBe(0);
    expect(s.grandTotal).toBeCloseTo(120);
  });
});

describe('computeBidSummaryFromSections', () => {
  const job: BidJobParams = { overhead_percent: 10, profit_percent: 10, bond_percent: 0, tax_percent: 0 };

  it('returns zeroes for an empty bid', () => {
    const s = computeBidSummaryFromSections([], job);
    expect(s.grandTotal).toBe(0);
    expect(s.direct_cost_total).toBe(0);
    expect(s.alternates).toEqual([]);
  });

  it('sums base sections and applies per-section markup overrides (including explicit 0)', () => {
    const s = computeBidSummaryFromSections(
      [
        section({ section_id: 1, name: 'A', material_total: 100, direct_cost_total: 100 }),
        // Override of 0 must win over the job's 10% — a blank override is null, not 0
        section({ section_id: 2, name: 'B', direct_cost_total: 200, overhead_percent_override: 0 }),
      ],
      job,
    );

    expect(s.direct_cost_total).toBe(300);
    expect(s.overhead).toBeCloseTo(10); // A only: 100 * 10%; B's override zeroes it
    expect(s.profit).toBeCloseTo(30); // both at job 10%
    expect(s.grandTotal).toBeCloseTo(300 + 10 + 30);
  });

  it('excludes alternates from the base bid and prices them independently', () => {
    const s = computeBidSummaryFromSections(
      [
        section({ section_id: 1, name: 'Base', direct_cost_total: 100 }),
        section({
          section_id: 2,
          name: 'Alt 1',
          is_alternate: 1,
          material_total: 1000,
          direct_cost_total: 1000,
          profit_percent_override: 20,
        }),
      ],
      job,
    );

    // Base bid sees only the non-alternate section
    expect(s.direct_cost_total).toBe(100);
    expect(s.grandTotal).toBeCloseTo(120);

    expect(s.alternates).toHaveLength(1);
    const alt = s.alternates[0];
    expect(alt.sectionId).toBe(2);
    expect(alt.overhead).toBeCloseTo(100);
    expect(alt.profit).toBeCloseTo(200); // its own 20% override
    expect(alt.grandTotal).toBeCloseTo(1000 + 100 + 200);
  });

  it('matches computeBidSummary when one section has no overrides', () => {
    const row = section({ material_total: 500, labor_total: 250, direct_cost_total: 750 });
    const jobWithEverything: BidJobParams = {
      overhead_percent: 8,
      profit_percent: 12,
      bond_percent: 1.5,
      tax_percent: 6,
      escalation_percent: 2,
    };
    const fromSections = computeBidSummaryFromSections([row], jobWithEverything);
    const direct = computeBidSummary(row, jobWithEverything);
    expect(fromSections.grandTotal).toBeCloseTo(direct.grandTotal);
    expect(fromSections.tax).toBeCloseTo(direct.tax);
    expect(fromSections.escalation).toBeCloseTo(direct.escalation);
  });

  it('marks up the indirect pool with job-level params, no tax or escalation', () => {
    const jobWithEverything: BidJobParams = {
      overhead_percent: 10,
      profit_percent: 10,
      bond_percent: 2,
      tax_percent: 7,
      escalation_percent: 3,
    };
    const base = computeBidSummaryFromSections(
      [section({ material_total: 1000, direct_cost_total: 1000 })], jobWithEverything, 0,
    );
    const withIndirects = computeBidSummaryFromSections(
      [section({ material_total: 1000, direct_cost_total: 1000 })], jobWithEverything, 500,
    );

    expect(withIndirects.indirect_total).toBe(500);
    // OH/profit/bond grow by the pool's share
    expect(withIndirects.overhead).toBeCloseTo(base.overhead + 50);
    expect(withIndirects.profit).toBeCloseTo(base.profit + 50);
    expect(withIndirects.bond).toBeCloseTo(base.bond + 10);
    // Tax and escalation are material-only: unchanged
    expect(withIndirects.tax).toBeCloseTo(base.tax);
    expect(withIndirects.escalation).toBeCloseTo(base.escalation);
    // Grand total grows by pool + its markups
    expect(withIndirects.grandTotal).toBeCloseTo(base.grandTotal + 500 + 50 + 50 + 10);
  });

  it('ignores section overrides for the indirect pool', () => {
    // Section zeroes its overhead; the pool still carries the job's 10%
    const s = computeBidSummaryFromSections(
      [section({ direct_cost_total: 100, overhead_percent_override: 0 })],
      job,
      1000,
    );
    expect(s.overhead).toBeCloseTo(100); // pool only
    expect(s.grandTotal).toBeCloseTo(100 + 0 + 10 /* section profit */ + 1000 + 100 + 100 /* pool profit */);
  });

  it('treats a negative indirect total as zero', () => {
    const s = computeBidSummaryFromSections([section({ direct_cost_total: 100 })], job, -50);
    expect(s.indirect_total).toBe(0);
    expect(s.grandTotal).toBeCloseTo(120);
  });
});
