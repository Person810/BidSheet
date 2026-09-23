/**
 * The owner-facing price schedule: every line at its SELL unit price, with
 * overhead, profit, bond, escalation, sales tax and the job's indirect and
 * freight pools folded in. Shared by the proposal PDF and the Unit Price
 * Schedule CSV so the two can never quote different prices.
 *
 * Unit prices govern. The sell price is computed to fractions of a cent, but
 * a bid form prints a rounded unit price and the owner extends it: extension
 * = quantity × printed unit price, and the bid total is the sum of the
 * extensions (the "unit prices govern" rule in DOT/municipal specs, and how
 * invoicing tools like QuickBooks compute an amount from qty × rate). So the
 * proposal total can differ from the estimate by the rounding — up to the
 * rounding increment × quantity per line — and `estimateBaseTotal` is kept
 * alongside so the estimator can see that difference before sending.
 */

export type UnitPriceRounding = 'up_cent' | 'nearest_cent' | 'up_dollar';

export const UNIT_PRICE_ROUNDING_OPTIONS: ReadonlyArray<{ value: UnitPriceRounding; label: string; hint: string }> = [
  { value: 'up_cent', label: 'Round up to the cent', hint: 'Never below your estimate; adds at most 1¢ per unit.' },
  { value: 'nearest_cent', label: 'Nearest cent', hint: 'Lands within a cent per unit above or below your estimate.' },
  { value: 'up_dollar', label: 'Round up to whole dollars', hint: 'Clean whole-dollar unit prices; adds up to $1 per unit.' },
];

export function isUnitPriceRounding(v: unknown): v is UnitPriceRounding {
  return v === 'up_cent' || v === 'nearest_cent' || v === 'up_dollar';
}

// Float noise guard: 27.12 * 100 is 2711.9999999999995, which must not
// round UP to 27.13. Anything within a millionth of a step counts as on it.
const EPS = 1e-6;

/** Round a unit price (or a lump-sum amount) to the chosen increment. */
export function roundUnitPrice(value: number, mode: UnitPriceRounding): number {
  if (!Number.isFinite(value)) return 0;
  let r: number;
  switch (mode) {
    case 'up_dollar':
      r = Math.ceil(value - EPS);
      break;
    case 'nearest_cent':
      r = Math.round((value + (value >= 0 ? EPS : -EPS) / 100) * 100) / 100;
      break;
    case 'up_cent':
    default:
      r = Math.ceil(value * 100 - EPS) / 100;
  }
  // ceil(0 − ε) is −0, which formats as "-$0.00" on a $0 line.
  return r === 0 ? 0 : r;
}

const cents = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export interface SellScheduleJob {
  overhead_percent?: number | null;
  profit_percent?: number | null;
  bond_percent?: number | null;
  tax_percent?: number | null;
  escalation_percent?: number | null;
  freight?: number | null;
}

export interface SellScheduleSection {
  id: number;
  name: string;
  is_alternate?: number | null;
  overhead_percent_override?: number | null;
  profit_percent_override?: number | null;
  bond_percent_override?: number | null;
}

export interface SellScheduleItem {
  id?: number;
  quantity?: number | null;
  material_total?: number | null;
  total_cost?: number | null;
  [key: string]: unknown;
}

export interface SellLine<T> {
  item: T;
  quantity: number;
  /** Printed unit price (rounded); for a zero-quantity line, 0. */
  unitPrice: number;
  /** quantity × unitPrice, or the rounded amount of a zero-quantity line. */
  extension: number;
}

export interface SellSection<T> {
  section: SellScheduleSection;
  lines: SellLine<T>[];
  subtotal: number;
}

export interface SellSchedule<T> {
  base: SellSection<T>[];
  alternates: SellSection<T>[];
  /**
   * Indirect + freight pool that had no priced base lines to spread into,
   * printed as its own lump-sum line; null when it was spread.
   */
  generalConditions: number | null;
  /** Sum of the printed base extensions (+ general conditions): the bid. */
  baseTotal: number;
  /** The same bid before rounding — the estimate's grand total. */
  estimateBaseTotal: number;
}

export function buildSellSchedule<T extends SellScheduleItem>(input: {
  job: SellScheduleJob;
  sections: SellScheduleSection[];
  itemsBySection: Record<number, T[]>;
  indirectTotal: number;
  freightTaxable: boolean;
  rounding: UnitPriceRounding;
}): SellSchedule<T> {
  const { job, sections, itemsBySection, rounding } = input;
  const escPct = num(job.escalation_percent) / 100;
  const taxPct = num(job.tax_percent) / 100;

  // Section markups resolve overrides the same way the bid summary does.
  const sectionMarkupPct = (s: SellScheduleSection) => (
    num(s.overhead_percent_override ?? job.overhead_percent)
    + num(s.profit_percent_override ?? job.profit_percent)
    + num(s.bond_percent_override ?? job.bond_percent)
  ) / 100;

  const lineSell = (item: T, markupPct: number): number => {
    const material = num(item.material_total);
    const escalatedMaterial = material * (1 + escPct);
    const directWithEsc = num(item.total_cost) - material + escalatedMaterial;
    return directWithEsc * (1 + markupPct) + escalatedMaterial * taxPct;
  };

  // Indirect pool and freight carry job-level markups (bidCalc), freight
  // tax when the setting says so, and are spread proportionally into the
  // base bid's unit prices — an owner-facing schedule shows neither.
  const jobMarkupPct = (num(job.overhead_percent) + num(job.profit_percent) + num(job.bond_percent)) / 100;
  const freight = Math.max(num(job.freight), 0);
  const freightSell = freight * (1 + jobMarkupPct) + (input.freightTaxable ? freight * taxPct : 0);
  const indirectSell = Math.max(num(input.indirectTotal), 0) * (1 + jobMarkupPct) + freightSell;

  const baseSections = sections.filter((s) => !s.is_alternate);
  const altSections = sections.filter((s) => s.is_alternate);

  let baseSellSum = 0;
  for (const s of baseSections) {
    const pct = sectionMarkupPct(s);
    for (const item of itemsBySection[s.id] ?? []) baseSellSum += lineSell(item, pct);
  }
  const spreadFactor = baseSellSum > 0 ? 1 + indirectSell / baseSellSum : 1;

  const build = (s: SellScheduleSection, factor: number): SellSection<T> => {
    const pct = sectionMarkupPct(s);
    const lines = (itemsBySection[s.id] ?? []).map((item): SellLine<T> => {
      const sell = lineSell(item, pct) * factor;
      const quantity = num(item.quantity);
      if (quantity > 0) {
        const unitPrice = roundUnitPrice(sell / quantity, rounding);
        return { item, quantity, unitPrice, extension: cents(unitPrice * quantity) };
      }
      return { item, quantity, unitPrice: 0, extension: roundUnitPrice(sell, rounding) };
    });
    return { section: s, lines, subtotal: cents(lines.reduce((t, l) => t + l.extension, 0)) };
  };

  const base = baseSections.map((s) => build(s, spreadFactor));
  // Alternates never carry the base bid's indirects.
  const alternates = altSections.map((s) => build(s, 1));

  let generalConditions: number | null = null;
  if (baseSellSum <= 0 && indirectSell > 0) {
    generalConditions = roundUnitPrice(indirectSell, rounding);
  }
  const baseTotal = cents(base.reduce((t, s) => t + s.subtotal, 0) + (generalConditions ?? 0));
  const estimateBaseTotal = cents(baseSellSum + indirectSell);
  return { base, alternates, generalConditions, baseTotal, estimateBaseTotal };
}
