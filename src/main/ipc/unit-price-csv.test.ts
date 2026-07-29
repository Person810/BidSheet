import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';

/**
 * export:unit-price-csv must reconcile with the bid summary: the schedule's
 * TOTAL BASE BID (spread unit prices, or the lump-sum fallback) has to land
 * on the same grand total db:jobs:summary reports, freight included.
 */
const handlers = new Map<string, (event: any, ...args: any[]) => any>();
let savePath = '';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', whenReady: () => Promise.resolve() },
  ipcMain: { handle: (channel: string, fn: any) => handlers.set(channel, fn) },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: savePath })),
  },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: vi.fn() },
}));

vi.mock('./documents', () => ({ removeJobFiles: vi.fn() }));

import { initializeDatabase } from '../database';
import { registerJobHandlers } from './jobs';
import { registerExportHandlers } from './export';

const call = (channel: string, ...args: any[]) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return fn(null, ...args);
};

describe('export:unit-price-csv freight reconciliation', () => {
  let db: Database.Database;

  beforeEach(() => {
    handlers.clear();
    savePath = path.join(os.tmpdir(), `unit-price-${Date.now()}-${Math.random()}.csv`);
    db = initializeDatabase(':memory:');
    registerJobHandlers(db);
    registerExportHandlers(db);
  });

  const makeJob = (freight: number) => {
    const jobId = Number(
      db
        .prepare(
          `INSERT INTO jobs (name, client, overhead_percent, profit_percent, bond_percent, tax_percent, freight)
           VALUES ('Job', 'GC', 10, 5, 0, 0, ?)`
        )
        .run(freight).lastInsertRowid
    );
    return jobId;
  };

  const addLineItem = (jobId: number, totalCost: number) => {
    const sectionId = Number(
      db
        .prepare("INSERT INTO bid_sections (job_id, name, sort_order) VALUES (?, 'Base', 0)")
        .run(jobId).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO bid_line_items (section_id, job_id, description, quantity, unit, sort_order, total_cost)
       VALUES (?, ?, 'Pipe', 10, 'LF', 0, ?)`
    ).run(sectionId, jobId, totalCost);
  };

  const totalBaseBid = (): number => {
    const csv = fs.readFileSync(savePath, 'utf-8');
    const line = csv.split('\r\n').find((l) => l.includes('TOTAL BASE BID'));
    expect(line).toBeTruthy();
    const cells = line!.split(',');
    return parseFloat(cells[cells.length - 1].replace(/"/g, ''));
  };

  it('spreads freight into unit prices so the schedule matches the summary', async () => {
    const jobId = makeJob(1000);
    addLineItem(jobId, 10000);

    const summary = await call('db:jobs:summary', jobId);
    const result = await call('export:unit-price-csv', jobId);
    expect(result.success).toBe(true);

    // grandTotal = 10000 + 1000 + 1100 OH + 550 profit = 12650
    expect(summary.grandTotal).toBeCloseTo(12650, 2);
    expect(totalBaseBid()).toBeCloseTo(summary.grandTotal, 0);
  });

  it('emits freight as a lump sum instead of dropping it when nothing can be spread', async () => {
    const jobId = makeJob(2000);
    // No line items at all: spread has nowhere to go.
    const summary = await call('db:jobs:summary', jobId);
    const result = await call('export:unit-price-csv', jobId);
    expect(result.success).toBe(true);

    const csv = fs.readFileSync(savePath, 'utf-8');
    expect(csv).toContain('General Conditions (indirect & freight)');
    expect(totalBaseBid()).toBeCloseTo(summary.grandTotal, 2);
    // The "spread" note must not claim spreading that never happened.
    expect(csv).not.toContain('spread indirect/freight costs');
  });
});
