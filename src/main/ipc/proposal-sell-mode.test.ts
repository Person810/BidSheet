import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * The proposal a GC reads must quote SELL prices and never expose cost or
 * margin (sell mode, the default); open book is the explicit opt-in that
 * itemizes the markup. In sell mode unit prices govern: every printed line
 * checks (qty × unit price = extension) and the total is their sum — and the
 * Unit Price Schedule CSV quotes the identical numbers.
 */
const { handlers, savePath } = vi.hoisted(() => ({
  handlers: new Map<string, (event: any, ...args: any[]) => any>(),
  savePath: { value: '' },
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', whenReady: () => Promise.resolve() },
  ipcMain: { handle: (channel: string, fn: any) => handlers.set(channel, fn) },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: savePath.value })),
  },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn(),
}));

import { initializeDatabase } from '../database';
import { registerExportHandlers } from './export';
import { DEFAULT_PDF_TEMPLATE, type PdfTemplate } from '../../shared/types/pdf';

const call = (channel: string, ...args: any[]) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return fn(null, ...args);
};

const money = (s: string) => Number(s.replace(/[$,]/g, ''));

/** Item rows: [qty, unitPrice, amount] parsed from the rendered table. */
function itemRows(html: string): Array<[number, number, number]> {
  const re = /<td class="center item-num">\d+<\/td>[\s\S]*?<td class="center">([^<]*)<\/td>\s*<td class="right">([^<]*)<\/td>\s*<td class="right">([^<]*)<\/td>/g;
  return [...html.matchAll(re)].map((m) => [Number(m[1]), money(m[2]), money(m[3])]);
}

describe('proposal PDF pricing modes', () => {
  let db: Database.Database;
  let jobId: number;

  beforeEach(() => {
    handlers.clear();
    savePath.value = path.join(os.tmpdir(), `sell-mode-${Date.now()}-${Math.random()}.csv`);
    db = initializeDatabase(':memory:');
    registerExportHandlers(db);
    jobId = Number(db.prepare(
      `INSERT INTO jobs (name, client, overhead_percent, profit_percent, bond_percent, tax_percent)
       VALUES ('Elm St', 'City', 12, 8, 1.5, 7)`
    ).run().lastInsertRowid);
    const sec = Number(db.prepare("INSERT INTO bid_sections (job_id, name, sort_order) VALUES (?, 'Sewer', 0)").run(jobId).lastInsertRowid);
    const add = (desc: string, qty: number, unit: string, material: number, total: number) =>
      db.prepare(
        `INSERT INTO bid_line_items (section_id, job_id, description, quantity, unit, sort_order, material_total, total_cost, unit_cost)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`
      ).run(sec, jobId, desc, qty, unit, material, total, total / qty);
    add('8" PVC SDR-35', 500, 'LF', 3750, 9152);
    add('48" Manhole', 2, 'EA', 5094, 5094);
    add('Tracer Wire', 537, 'LF', 118.14, 118.14);
    db.prepare("INSERT INTO job_indirect_costs (job_id, description, amount) VALUES (?, 'Mobilization', 4500)").run(jobId);
  });

  const html = (t: Partial<PdfTemplate> = {}) =>
    call('jobs:get-pdf-html', jobId, { ...DEFAULT_PDF_TEMPLATE, ...t }) as Promise<string>;

  it('sell mode (the default) shows no cost, markup or cost breakdown', async () => {
    const h = await html({ showCostBreakdown: true });
    for (const leak of ['Overhead', 'Profit', 'Bond', 'Sales Tax', 'Direct Cost', 'Indirect Costs', 'Cost Breakdown']) {
      expect(h).not.toContain(leak);
    }
    // The pipe is quoted at sell, not its $18.30/LF cost.
    expect(h).not.toContain('$18.30');
  });

  it('every line checks and the total is the sum of the printed extensions', async () => {
    const h = await html();
    const rows = itemRows(h);
    expect(rows).toHaveLength(3);
    for (const [qty, unit, amount] of rows) expect(amount).toBeCloseTo(qty * unit, 2);
    const total = money(h.match(/TOTAL BID AMOUNT<\/td><td class="sum-val">([^<]*)</)![1]);
    expect(total).toBeCloseTo(rows.reduce((t, r) => t + r[2], 0), 2);
  });

  it('rounding up never quotes below the estimate', async () => {
    const t = await call('jobs:proposal-totals', jobId, 'up_cent');
    expect(t.proposalTotal).toBeGreaterThanOrEqual(t.estimateTotal);
    expect(t.proposalTotal - t.estimateTotal).toBeLessThan((500 + 2 + 537) * 0.01);
    const dollars = await call('jobs:proposal-totals', jobId, 'up_dollar');
    expect(dollars.proposalTotal).toBeGreaterThanOrEqual(t.proposalTotal);
  });

  it('the Unit Price Schedule CSV quotes the same total as the PDF', async () => {
    const h = await html();
    const pdfTotal = money(h.match(/TOTAL BID AMOUNT<\/td><td class="sum-val">([^<]*)</)![1]);
    await call('export:unit-price-csv', jobId);
    const csv = fs.readFileSync(savePath.value, 'utf-8');
    const line = csv.split('\r\n').find((l) => l.includes('TOTAL BASE BID'))!;
    expect(Number(line.split(',').pop())).toBeCloseTo(pdfTotal, 2);
  });

  it('open book itemizes cost and markup and still reconciles to the estimate', async () => {
    const h = await html({ pricingMode: 'open_book', showCostBreakdown: true });
    expect(h).toContain('Overhead (12%)');
    expect(h).toContain('Profit (8%)');
    expect(h).toContain('Cost Breakdown');
    expect(h).toContain('$18.30');
    const t = await call('jobs:proposal-totals', jobId, 'up_cent');
    expect(h).toContain(`TOTAL BID AMOUNT</td><td class="sum-val">$${t.estimateTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  });

  it('an unrecognized mode from the renderer falls back to sell, never open book', async () => {
    const h = await html({ pricingMode: 'bogus' as any, unitPriceRounding: 'nonsense' as any });
    expect(h).not.toContain('Overhead');
    expect(itemRows(h).length).toBe(3);
  });
});
