/**
 * QuickBooks Online CSV export for bid estimates.
 *
 * Generates a CSV string compatible with QBO's invoice/estimate import.
 * Each line item becomes one row; job-level fields repeat on every row.
 */

interface ExportJob {
  name: string;
  job_number: string | null;
  client: string | null;
  location: string | null;
  bid_date: string | null;
  overhead_percent: number;
  profit_percent: number;
  bond_percent: number;
  tax_percent: number;
}

interface ExportSection {
  id: number;
  name: string;
}

interface ExportLineItem {
  description: string;
  quantity: number;
  unit: string;
  unit_cost: number;
  total_cost: number;
}

interface ExportSummary {
  overhead: number;
  profit: number;
  bond: number;
  tax: number;
}

export interface CSVExportData {
  job: ExportJob;
  sections: ExportSection[];
  lineItemsBySection: Record<number, ExportLineItem[]>;
  summary: ExportSummary;
}

const COLUMNS = [
  '*Customer',
  '*InvoiceNo',
  '*InvoiceDate',
  '*DueDate',
  'Terms',
  'Location',
  'Memo',
  '*ItemDescription',
  '*ItemQuantity',
  '*ItemUnitPrice',
  '*ItemAmount',
  'ItemTaxCode',
  'ServiceDate',
];

/** Escape a field value per RFC 4180: quote if it contains comma, quote, or newline. */
function escapeField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/** Format a date string (ISO or YYYY-MM-DD) as MM/DD/YYYY for QuickBooks. */
function formatDate(dateStr: string | null): string {
  if (!dateStr) {
    const now = new Date();
    return `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    const now = new Date();
    return `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getFullYear()}`;
  }
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Format a number to 2 decimal places. */
function fmt(n: number): string {
  return n.toFixed(2);
}

function buildRow(
  customer: string,
  invoiceNo: string,
  date: string,
  location: string,
  memo: string,
  description: string,
  quantity: number | string,
  unitPrice: number | string,
  amount: number | string,
): string {
  const fields = [
    customer,
    invoiceNo,
    date,
    date,       // DueDate = InvoiceDate
    '',         // Terms
    location,
    memo,
    description,
    String(quantity),
    String(unitPrice),
    String(amount),
    '',         // ItemTaxCode
    '',         // ServiceDate
  ];
  return fields.map(escapeField).join(',');
}

export function generateEstimateCSV(data: CSVExportData): string {
  const { job, sections, lineItemsBySection, summary } = data;

  const customer = job.client || 'Customer';
  const invoiceNo = job.job_number || job.name;
  const date = formatDate(job.bid_date);
  const location = job.location || '';
  const memo = job.name;

  const lines: string[] = [];

  // UTF-8 BOM + header row
  lines.push('\uFEFF' + COLUMNS.join(','));

  // Line items grouped by section
  for (const section of sections) {
    const items = lineItemsBySection[section.id] || [];
    for (const item of items) {
      const desc = sections.length > 1
        ? `[${section.name}] ${item.description}`
        : item.description;
      lines.push(buildRow(
        customer, invoiceNo, date, location, memo,
        desc, fmt(item.quantity), fmt(item.unit_cost), fmt(item.total_cost),
      ));
    }
  }

  // Markup rows (skip if zero)
  if (summary.overhead > 0) {
    lines.push(buildRow(
      customer, invoiceNo, date, location, memo,
      `Overhead (${fmt(job.overhead_percent)}%)`, 1, fmt(summary.overhead), fmt(summary.overhead),
    ));
  }
  if (summary.profit > 0) {
    lines.push(buildRow(
      customer, invoiceNo, date, location, memo,
      `Profit (${fmt(job.profit_percent)}%)`, 1, fmt(summary.profit), fmt(summary.profit),
    ));
  }
  if (summary.bond > 0) {
    lines.push(buildRow(
      customer, invoiceNo, date, location, memo,
      `Bond (${fmt(job.bond_percent)}%)`, 1, fmt(summary.bond), fmt(summary.bond),
    ));
  }
  if (summary.tax > 0) {
    lines.push(buildRow(
      customer, invoiceNo, date, location, memo,
      `Sales Tax (${fmt(job.tax_percent)}%)`, 1, fmt(summary.tax), fmt(summary.tax),
    ));
  }

  return lines.join('\r\n') + '\r\n';
}
