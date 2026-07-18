/**
 * Shared bid summary calculation.
 *
 * Single source of truth for overhead / profit / bond / tax math
 * so the UI, PDF export, and QuickBooks CSV always agree.
 *
 * Markups apply per section: each section uses the job percentages unless
 * it carries an override. Alternate sections are excluded from the base bid
 * and priced independently (each alternate gets its own marked-up total).
 */

import type { CalcBreakdown } from './calcExplain';
import { explainProduct, explainPercentOf, explainSum, fmtMoney, fmtNum } from './calcExplain';

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
  /** Material price escalation for long-lead bids (job-level) */
  escalation_percent?: number | null;
}

export interface BidSummary {
  /** Material escalation dollars — part of escalated direct cost, so markups apply on top */
  escalation: number;
  overhead: number;
  profit: number;
  bond: number;
  tax: number;
  grandTotal: number;
}

/** Per-section cost roll-up plus the markup config stored on the section. */
export interface SectionCostRow extends BidTotals {
  section_id: number;
  name: string;
  is_alternate: number;
  overhead_percent_override: number | null;
  profit_percent_override: number | null;
  bond_percent_override: number | null;
}

export interface AlternateSummary extends BidTotals, BidSummary {
  sectionId: number;
  name: string;
}

export interface FullBidSummary extends BidTotals, BidSummary {
  /**
   * Job-level indirect costs (mobilization, traffic control, dewatering,
   * trailers…) entered once instead of faked as line items. Joins the bid
   * before markups: job-level OH/profit/bond apply on top of it, but tax
   * and escalation don't (it isn't material).
   */
  indirect_total: number;
  /** Each alternate section priced independently with its own markups */
  alternates: AlternateSummary[];
}

/** Shape carrying the dollar amounts a breakdown needs (a FullBidSummary works). */
interface SummaryAmounts {
  material_total: number;
  labor_total: number;
  equipment_total: number;
  subcontractor_total: number;
  direct_cost_total: number;
  escalation: number;
  overhead: number;
  profit: number;
  bond: number;
  tax: number;
  grandTotal: number;
  /** Optional: job-level indirect cost pool (alternates never carry one) */
  indirect_total?: number;
}

/** Direct cost = material + labor + equipment + subcontractor (across base sections). */
export function explainDirectCost(s: SummaryAmounts): CalcBreakdown {
  return explainSum(
    'Direct cost = material + labor + equipment + subcontractor',
    [
      { label: 'Material', value: fmtMoney(s.material_total) },
      { label: 'Labor', value: fmtMoney(s.labor_total) },
      { label: 'Equipment', value: fmtMoney(s.equipment_total) },
      { label: 'Subcontractor', value: fmtMoney(s.subcontractor_total) },
    ],
    { label: 'Direct cost', value: fmtMoney(s.direct_cost_total) },
  );
}

export function explainEscalation(s: SummaryAmounts, escalationPct: number): CalcBreakdown {
  return explainProduct(
    'Material escalation = material total × escalation %',
    { label: 'Material total', value: fmtMoney(s.material_total) },
    { label: 'Escalation %', value: `${fmtNum(escalationPct, 3)}%` },
    { label: 'Escalation', value: fmtMoney(s.escalation) },
  );
}

/**
 * Markup breakdown. Overhead/profit/bond apply to (direct cost + escalation);
 * sales tax applies to (material + escalation). When sections override the job
 * markups the displayed rate is blended (derived from base and result), with a
 * note — so the popover never claims a single rate that isn't the truth.
 */
export function explainMarkup(
  kind: 'overhead' | 'profit' | 'bond' | 'tax', s: SummaryAmounts, hasOverrides: boolean,
): CalcBreakdown {
  if (kind === 'tax') {
    return explainPercentOf('Sales tax', 'Material + escalation', s.material_total + s.escalation, s.tax);
  }
  const label = kind === 'overhead' ? 'Overhead' : kind === 'profit' ? 'Profit' : 'Bond';
  const note = hasOverrides ? 'Blended rate — some sections override the job markups.' : undefined;
  return explainPercentOf(label, 'Direct cost + escalation', s.direct_cost_total + s.escalation, s[kind], note);
}

/** Bid total = direct cost + escalation + overhead + profit + bond + tax. */
export function explainGrandTotal(s: SummaryAmounts): CalcBreakdown {
  const indirect = s.indirect_total || 0;
  return explainSum(
    indirect > 0
      ? 'Bid total = direct cost + escalation + indirects + markups + tax'
      : 'Bid total = direct cost + escalation + markups + tax',
    [
      { label: 'Direct cost', value: fmtMoney(s.direct_cost_total) },
      { label: 'Escalation', value: fmtMoney(s.escalation) },
      ...(indirect > 0 ? [{ label: 'Indirect costs', value: fmtMoney(indirect) }] : []),
      { label: 'Overhead', value: fmtMoney(s.overhead) },
      { label: 'Profit', value: fmtMoney(s.profit) },
      { label: 'Bond', value: fmtMoney(s.bond) },
      { label: 'Sales tax', value: fmtMoney(s.tax) },
    ],
    { label: 'Bid total', value: fmtMoney(s.grandTotal) },
  );
}

export function computeBidSummary(totals: BidTotals, job: BidJobParams): BidSummary {
  // Escalation raises the expected material cost, so it joins the direct
  // cost before markups and is taxed like the materials it represents
  const escalation = totals.material_total * ((job.escalation_percent || 0) / 100);
  const directCost = totals.direct_cost_total + escalation;
  const overhead = directCost * (job.overhead_percent / 100);
  const profit = directCost * (job.profit_percent / 100);
  const bond = directCost * ((job.bond_percent || 0) / 100);
  const tax = (totals.material_total + escalation) * ((job.tax_percent || 0) / 100);

  return {
    escalation,
    overhead,
    profit,
    bond,
    tax,
    grandTotal: directCost + overhead + profit + bond + tax,
  };
}

/** Job params with any section-level overrides applied. */
export function sectionParams(
  section: Pick<SectionCostRow, 'overhead_percent_override' | 'profit_percent_override' | 'bond_percent_override'>,
  job: BidJobParams,
): BidJobParams {
  return {
    overhead_percent: section.overhead_percent_override ?? job.overhead_percent,
    profit_percent: section.profit_percent_override ?? job.profit_percent,
    bond_percent: section.bond_percent_override ?? job.bond_percent,
    tax_percent: job.tax_percent,
    escalation_percent: job.escalation_percent,
  };
}

const EMPTY_TOTALS: BidTotals = {
  material_total: 0, labor_total: 0, equipment_total: 0,
  subcontractor_total: 0, direct_cost_total: 0,
};

function addTotals(acc: BidTotals, row: BidTotals): void {
  acc.material_total += row.material_total;
  acc.labor_total += row.labor_total;
  acc.equipment_total += row.equipment_total;
  acc.subcontractor_total += row.subcontractor_total;
  acc.direct_cost_total += row.direct_cost_total;
}

/**
 * Compute the full bid summary from per-section cost rows.
 *
 * Base totals/markups cover non-alternate sections only; each alternate
 * section is returned separately with its own marked-up total.
 *
 * `indirectTotal` is the job-level indirect-cost pool (mobilization, bond
 * riders, traffic control…). It belongs to the base bid: job-level
 * overhead/profit/bond percentages apply to it, tax and escalation do not.
 */
export function computeBidSummaryFromSections(
  rows: SectionCostRow[],
  job: BidJobParams,
  indirectTotal = 0,
): FullBidSummary {
  const baseTotals: BidTotals = { ...EMPTY_TOTALS };
  let escalation = 0;
  let overhead = 0;
  let profit = 0;
  let bond = 0;
  let tax = 0;
  const alternates: AlternateSummary[] = [];

  for (const row of rows) {
    const params = sectionParams(row, job);
    const summary = computeBidSummary(row, params);
    if (row.is_alternate) {
      alternates.push({
        sectionId: row.section_id,
        name: row.name,
        material_total: row.material_total,
        labor_total: row.labor_total,
        equipment_total: row.equipment_total,
        subcontractor_total: row.subcontractor_total,
        direct_cost_total: row.direct_cost_total,
        ...summary,
      });
    } else {
      addTotals(baseTotals, row);
      escalation += summary.escalation;
      overhead += summary.overhead;
      profit += summary.profit;
      bond += summary.bond;
      tax += summary.tax;
    }
  }

  // Indirect pool: job-level OH/profit/bond apply (never section
  // overrides — indirects aren't in any section); no tax, no escalation.
  const indirect = Math.max(indirectTotal, 0);
  overhead += indirect * (job.overhead_percent / 100);
  profit += indirect * (job.profit_percent / 100);
  bond += indirect * ((job.bond_percent || 0) / 100);

  return {
    ...baseTotals,
    escalation,
    indirect_total: indirect,
    overhead,
    profit,
    bond,
    tax,
    grandTotal:
      baseTotals.direct_cost_total + escalation + indirect + overhead + profit + bond + tax,
    alternates,
  };
}
