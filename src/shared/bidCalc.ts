/**
 * Shared bid summary calculation.
 *
 * Single source of truth for overhead / profit / bond / tax math
 * so the UI, PDF export, and QuickBooks CSV always agree.
 */

export interface BidTotals {
  material_total: number;
  labor_total: number;
  equipment_total: number;
  subcontractor_total: number;
  direct_cost_total: number;
}

export interface BidJobParams {
  overhead_percent: number;
  profit_percent: number;
  bond_percent?: number | null;
  tax_percent?: number | null;
}

export interface BidSummary {
  overhead: number;
  profit: number;
  bond: number;
  tax: number;
  grandTotal: number;
}

export function computeBidSummary(totals: BidTotals, job: BidJobParams): BidSummary {
  const directCost = totals.direct_cost_total;
  const overhead = directCost * (job.overhead_percent / 100);
  const profit = directCost * (job.profit_percent / 100);
  const bond = directCost * ((job.bond_percent || 0) / 100);
  const tax = totals.material_total * ((job.tax_percent || 0) / 100);

  return {
    overhead,
    profit,
    bond,
    tax,
    grandTotal: directCost + overhead + profit + bond + tax,
  };
}
