import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';

/**
 * The proposal PDF is the one artifact a customer actually reads, and until
 * now nothing tested it. The invariant that matters commercially is simple:
 * **the summary rows must add up to the printed total.** They did not when a
 * contractor priced markup per section, because the rows were gated on the
 * job-level percentage while the dollars came from the section overrides.
 *
 * Driven through the real `jobs:get-pdf-html` handler rather than the private
 * builder, because half the defect lived in how the data was gathered.
 */
const handlers = new Map<string, (event: any, ...args: any[]) => any>();

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', whenReady: () => Promise.resolve() },
  ipcMain: { handle: (channel: string, fn: any) => handlers.set(channel, fn) },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: vi.fn(),
}));

import { initializeDatabase } from '../database';
import { registerExportHandlers } from './export';
import { DEFAULT_PDF_TEMPLATE } from '../../shared/types/pdf';

const getHtml = (jobId: number) => {
  const fn = handlers.get('jobs:get-pdf-html');
  if (!fn) throw new Error('handler not registered');
  return fn(null, jobId, DEFAULT_PDF_TEMPLATE) as Promise<string>;
};

/** Every `<td class="sum-val">$1,234.56</td>` in document order. */
function summaryValues(html: string): number[] {
  return [...html.matchAll(/<td class="sum-val">([^<]*)<\/td>/g)].map((m) =>
    Number(m[1].replace(/[$,]/g, ''))
  );
}

function summaryLabels(html: string): string[] {
  return [...html.matchAll(/<td class="sum-label[^"]*"(?: colspan="2")?>([^<]*)<\/td>/g)].map(
    (m) => m[1]
  );
}

describe('bid proposal PDF summary', () => {
  let db: Database.Database;

  beforeEach(() => {
    handlers.clear();
    db = initializeDatabase(':memory:');
    registerExportHandlers(db);
  });

  /** A job with one base section and one line item, plus optional overrides. */
  const makeJob = (
    job: Record<string, number>,
    section: Record<string, number | null> = {},
    directCost = 10000
  ) => {
    const jobId = Number(
      db
        .prepare(
          `INSERT INTO jobs (name, client, overhead_percent, profit_percent, bond_percent,
                             tax_percent, escalation_percent)
           VALUES ('Airport Taxiway', 'Boh Bros', ?, ?, ?, ?, ?)`
        )
        .run(
          job.overhead ?? 0,
          job.profit ?? 0,
          job.bond ?? 0,
          job.tax ?? 0,
          job.escalation ?? 0
        ).lastInsertRowid
    );
    const sectionId = Number(
      db
        .prepare(
          `INSERT INTO bid_sections (job_id, name, sort_order, overhead_percent_override,
                                     profit_percent_override, bond_percent_override)
           VALUES (?, 'Base Bid', 0, ?, ?, ?)`
        )
        .run(
          jobId,
          section.overhead ?? null,
          section.profit ?? null,
          section.bond ?? null
        ).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO bid_line_items (job_id, section_id, description, unit, quantity, sort_order,
                                   material_total, total_cost)
       VALUES (?, ?, 'Storm pipe', 'LF', 1, 0, ?, ?)`
    ).run(jobId, sectionId, directCost, directCost);
    return { jobId, sectionId };
  };

  it('rows sum to the total when markup is priced per section', async () => {
    // The reported case: job percentages are 0, the section carries the rates.
    const { jobId } = makeJob({}, { overhead: 12, profit: 8 });
    const html = await getHtml(jobId);
    const values = summaryValues(html);
    const total = values[values.length - 1];

    expect(total).toBe(12000);
    // Direct cost + every markup row = the printed total, with nothing missing.
    expect(values.slice(0, -1).reduce((a, b) => a + b, 0)).toBe(total);
    expect(summaryLabels(html)).toContain('Overhead *');
    expect(html).toContain('Rates vary by section');
  });

  it('omits a markup row that is genuinely zero rather than printing 0%', async () => {
    // Job says 10% overhead, the section overrides it to 0 — the old gate
    // printed "Overhead (10%) $0.00" on a document handed to an owner.
    const { jobId } = makeJob({ overhead: 10 }, { overhead: 0 });
    const html = await getHtml(jobId);
    expect(summaryLabels(html).some((l) => l.startsWith('Overhead'))).toBe(false);
    // No summary row is worth zero dollars — a $0.00 line on a proposal reads
    // as a mistake to the person pricing against it.
    expect(summaryValues(html).slice(0, -1)).not.toContain(0);
  });

  it('keeps the plain rate label when no section overrides anything', async () => {
    const { jobId } = makeJob({ overhead: 10, profit: 5, bond: 2, tax: 8, escalation: 3 });
    const html = await getHtml(jobId);
    const labels = summaryLabels(html);
    expect(labels).toContain('Overhead (10%)');
    expect(labels).toContain('Profit (5%)');
    expect(labels).toContain('Bond (2%)');
    expect(html).not.toContain('Rates vary by section');

    const values = summaryValues(html);
    expect(values.slice(0, -1).reduce((a, b) => a + b, 0)).toBeCloseTo(
      values[values.length - 1],
      2
    );
  });

  it('reconciles across a matrix of markup shapes', async () => {
    const shapes: [Record<string, number>, Record<string, number | null>][] = [
      [{ overhead: 10, profit: 10 }, {}],
      [{}, { overhead: 15, profit: 10, bond: 2 }],
      [{ overhead: 10, profit: 10, bond: 2, tax: 8 }, { overhead: 0 }],
      [{ escalation: 12, overhead: 10, tax: 9.5 }, { profit: 6 }],
      [{ tax: 8 }, {}],
    ];
    for (const [job, section] of shapes) {
      handlers.clear();
      db = initializeDatabase(':memory:');
      registerExportHandlers(db);
      const { jobId } = makeJob(job, section);
      const values = summaryValues(await getHtml(jobId));
      expect(values.slice(0, -1).reduce((a, b) => a + b, 0)).toBeCloseTo(
        values[values.length - 1],
        2
      );
    }
  });

  it('never emits a non-numeric money value into the document', async () => {
    // A line item's total_cost can arrive from a sync snapshot pushed by
    // another org member. SQLite will store the string as-is in a REAL column.
    const { sectionId, jobId } = makeJob({ overhead: 10 });
    db.prepare('UPDATE bid_line_items SET total_cost = ? WHERE section_id = ?').run(
      "<img src=x onerror=alert(1)>",
      sectionId
    );
    const html = await getHtml(jobId);
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img src=x');
    // And the running subtotal stayed a number rather than concatenating.
    expect(html).toContain('<td class="right subtotal-val">$0.00</td>');
  });

  it('sends a policy that forbids script and network access', async () => {
    const { jobId } = makeJob({ overhead: 10 });
    const html = await getHtml(jobId);
    expect(html).toContain("default-src 'none'");
  });
});
