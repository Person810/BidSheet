import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';

/**
 * db:jobs:duplicate and db:jobs:create-change-order copy semantics for the
 * V49 fields: a duplicate is a full template (freight included); a change
 * order shares the parent's dig site but carries its own freight, because
 * the parent's freight is already priced in the parent's bid.
 */
const handlers = new Map<string, (event: any, ...args: any[]) => any>();

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', whenReady: () => Promise.resolve() },
  ipcMain: { handle: (channel: string, fn: any) => handlers.set(channel, fn) },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('./documents', () => ({ removeJobFiles: vi.fn() }));

import { initializeDatabase } from '../database';
import { registerJobHandlers } from './jobs';

const call = (channel: string, ...args: any[]) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return fn(null, ...args);
};

describe('job copy semantics for freight and site fields', () => {
  let db: Database.Database;
  let sourceId: number;

  beforeEach(() => {
    handlers.clear();
    db = initializeDatabase(':memory:');
    registerJobHandlers(db);
    sourceId = Number(
      db
        .prepare(
          `INSERT INTO jobs (name, client, location, freight, site_postcode, site_country,
                             overhead_percent, profit_percent, bond_percent, tax_percent, escalation_percent)
           VALUES ('Canal St Sewer', 'Boh Bros', '1400 Canal St', 350, '70112', 'United States',
                   10, 10, 2, 8, 12)`
        )
        .run().lastInsertRowid
    );
  });

  it('duplicating a job copies freight and the site fields', async () => {
    const { newJobId } = await call('db:jobs:duplicate', sourceId, 'Copied Job');
    const copy = db
      .prepare('SELECT freight, site_postcode, site_country FROM jobs WHERE id = ?')
      .get(newJobId) as any;
    expect(copy.freight).toBe(350);
    expect(copy.site_postcode).toBe('70112');
    expect(copy.site_country).toBe('United States');
  });

  it('a change order inherits the dig site but not the freight', async () => {
    const { newJobId } = await call('db:jobs:create-change-order', sourceId);
    const co = db
      .prepare('SELECT freight, site_postcode, site_country, parent_job_id FROM jobs WHERE id = ?')
      .get(newJobId) as any;
    expect(co.parent_job_id).toBe(sourceId);
    expect(co.site_postcode).toBe('70112');
    expect(co.site_country).toBe('United States');
    // The parent's freight is priced in the parent's bid; the CO starts at 0.
    expect(co.freight).toBe(0);
  });

  it('a change order inherits every markup rate, escalation included', async () => {
    const { newJobId } = await call('db:jobs:create-change-order', sourceId);
    const co = db
      .prepare(
        `SELECT overhead_percent, profit_percent, bond_percent, tax_percent, escalation_percent
         FROM jobs WHERE id = ?`
      )
      .get(newJobId) as any;
    expect(co).toEqual({
      overhead_percent: 10,
      profit_percent: 10,
      bond_percent: 2,
      tax_percent: 8,
      // A CO is priced in the same market as the parent. Dropping this
      // under-prices every CO on a long-lead job by the escalation rate.
      escalation_percent: 12,
    });
  });

  it('duplicating a job inherits every markup rate, escalation included', async () => {
    const { newJobId } = await call('db:jobs:duplicate', sourceId, 'Copied Job');
    const copy = db
      .prepare('SELECT escalation_percent FROM jobs WHERE id = ?')
      .get(newJobId) as any;
    expect(copy.escalation_percent).toBe(12);
  });
});
