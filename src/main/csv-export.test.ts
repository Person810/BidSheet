import { describe, expect, it } from 'vitest';
import { escapeField, generateEstimateCSV, type CSVExportData } from './csv-export';

describe('escapeField', () => {
  it('passes plain values through unquoted', () => {
    expect(escapeField('plain')).toBe('plain');
    expect(escapeField('8 inch PVC SDR-35')).toBe('8 inch PVC SDR-35');
  });

  it('quotes fields containing commas', () => {
    expect(escapeField('Smith, Jones & Co')).toBe('"Smith, Jones & Co"');
  });

  it('quotes fields containing quote marks and doubles them', () => {
    expect(escapeField('8" PVC SDR-35')).toBe('"8"" PVC SDR-35"');
    expect(escapeField('the "best" bid, really')).toBe('"the ""best"" bid, really"');
  });

  it('quotes fields containing newlines', () => {
    expect(escapeField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeField('line1\rline2')).toBe('"line1\rline2"');
  });

  it('neutralizes spreadsheet formula injection without mangling numbers', () => {
    // Leading =,+,-,@ in user text would evaluate as a formula in Excel.
    expect(escapeField('=cmd|/c calc')).toBe("'=cmd|/c calc"); // prefixed; no comma so not quoted
    expect(escapeField('@SUM(1)')).toBe("'@SUM(1)");
    // Formula trigger AND a comma: prefixed, then RFC-quoted.
    expect(escapeField('=HYPERLINK(x), evil')).toBe('"\'=HYPERLINK(x), evil"');
    // A genuine negative amount must still import as a number.
    expect(escapeField('-5.00')).toBe('-5.00');
  });
});

const baseData = (): CSVExportData => ({
  job: {
    name: 'Elm Street Sewer',
    job_number: 'J-100',
    client: 'ACME GC',
    location: 'Elm St',
    bid_date: '2026-06-01',
    overhead_percent: 10,
    profit_percent: 5,
    bond_percent: 1,
    tax_percent: 7,
    escalation_percent: 0,
  },
  sections: [{ id: 1, name: 'Sanitary' }],
  lineItemsBySection: {
    1: [{ description: '8" PVC', quantity: 100, unit: 'LF', unit_cost: 32.5, total_cost: 3250 }],
  },
  summary: { overhead: 325, profit: 162.5, bond: 32.5, tax: 227.5 },
});

describe('generateEstimateCSV', () => {
  it('emits a BOM, header row, and CRLF line endings', () => {
    const csv = generateEstimateCSV(baseData());
    expect(csv.startsWith('\uFEFF' + '*Customer,')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv).not.toMatch(/[^\r]\n/); // every newline is CRLF
  });

  it('formats the bid date as MM/DD/YYYY without timezone shift', () => {
    const csv = generateEstimateCSV(baseData());
    expect(csv).toContain('06/01/2026');
  });

  it('writes one row per line item plus one per nonzero markup', () => {
    const csv = generateEstimateCSV(baseData());
    const rows = csv.trim().split('\r\n');
    // header + 1 item + overhead + profit + bond + tax
    expect(rows).toHaveLength(6);
    expect(csv).toContain('Overhead (10.00%)');
    expect(csv).toContain('Profit (5.00%)');
    expect(csv).toContain('Bond (1.00%)');
    expect(csv).toContain('Sales Tax (7.00%)');
  });

  it('skips zero markup rows', () => {
    const data = baseData();
    data.summary = { overhead: 325, profit: 162.5, bond: 0, tax: 0 };
    const csv = generateEstimateCSV(data);
    expect(csv).not.toContain('Bond');
    expect(csv).not.toContain('Sales Tax');
  });

  it('adds an escalation row when escalation is nonzero', () => {
    const data = baseData();
    data.job.escalation_percent = 3;
    data.summary.escalation = 97.5;
    const csv = generateEstimateCSV(data);
    expect(csv).toContain('Material Escalation (3.00%)');
  });

  it('prefixes descriptions with the section name only when there are multiple sections', () => {
    const single = generateEstimateCSV(baseData());
    expect(single).not.toContain('[Sanitary]');

    const data = baseData();
    data.sections = [{ id: 1, name: 'Sanitary' }, { id: 2, name: 'Storm' }];
    data.lineItemsBySection[2] = [{ description: '15" RCP', quantity: 50, unit: 'LF', unit_cost: 60, total_cost: 3000 }];
    const multi = generateEstimateCSV(data);
    expect(multi).toContain('[Sanitary] 8"" PVC'); // inside a quoted field, " doubles
    expect(multi).toContain('[Storm] 15"" RCP');
  });

  it('drops misleading percent labels when sections override the job markups', () => {
    const data = baseData();
    data.hasMarkupOverrides = true;
    const csv = generateEstimateCSV(data);
    expect(csv).toContain('Overhead,');
    expect(csv).not.toContain('Overhead (10.00%)');
    expect(csv).not.toContain('Profit (5.00%)');
    // Tax label keeps its percent — it is never overridden per section
    expect(csv).toContain('Sales Tax (7.00%)');
  });
});
