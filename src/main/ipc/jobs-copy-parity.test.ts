import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';

/**
 * Schema-driven parity guard for db:jobs:duplicate and
 * db:jobs:create-change-order.
 *
 * WHY THIS EXISTS
 * ---------------
 * The same bug has now shipped twice. F19: duplicate and change-order silently
 * dropped the three V49 columns (freight, site_postcode, site_country), so
 * re-bidding last year's job came back with Freight $0 and empty Postcode.
 * F30: the change-order INSERT omitted escalation_percent, so every CO off an
 * escalated bid went out ~11% light — and the PR that fixed the V49 columns
 * touched that exact statement without noticing.
 *
 * jobs-copy.test.ts pins those specific fields, which stops F19 and F30 from
 * regressing but does nothing about the NEXT column. The fix note on F19 asked
 * for exactly this: "extend the #137-style guard test to the duplicate/
 * change-order handlers so the next v50 column cannot be forgotten the same
 * way."
 *
 * So this test is driven by `PRAGMA table_info(jobs)` rather than a hand-written
 * field list. Add a column in V51 and this fails until someone states, in the
 * map below, whether a duplicate and a change order should inherit it. That is
 * the decision that got skipped twice; the test makes skipping it impossible
 * rather than merely discouraged.
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

/**
 * Columns a DUPLICATE is not expected to carry over, each with the reason.
 * A duplicate is "bid this same work again", so the default is: copy it.
 */
const DUPLICATE_EXEMPT: Record<string, string> = {
  id: 'new row',
  name: 'the copy is renamed by the caller',
  job_number: 'must be unique per job',
  created_at: 'the copy is new',
  updated_at: 'the copy is new',
  bid_date: 'caller supplies a new bid date',
  status: 'a copy starts as a draft regardless of the source status',
  parent_job_id: 'a duplicate is a top-level job, not a change order',
  change_order_number: 'ditto',
  cloud_id: 'sync identity is per-row',
  bid_locked: 'bid_locked freezes a won/lost bid against price re-import; a fresh copy is editable',
};

/**
 * Columns a CHANGE ORDER is not expected to inherit. A CO shares the parent's
 * site and markup structure but is its own priced scope.
 */
const CHANGE_ORDER_EXEMPT: Record<string, string> = {
  ...DUPLICATE_EXEMPT,
  parent_job_id: 'set to the parent — checked separately below',
  change_order_number: 'assigned by the handler',
  freight: "the parent's freight is already priced in the parent's bid; the CO carries its own (jobs.ts:466-468)",
  description: 'a CO describes its own scope (explicit null at jobs.ts:462)',
  notes: 'a CO carries its own notes (explicit null at jobs.ts:470, beside description)',
  start_date: 'a CO is scheduled independently',
};

describe('job copy parity — every jobs column is a deliberate decision', () => {
  let db: Database.Database;
  let parentId: number;
  let columns: Array<{ name: string; type: string; notnull: number }>;

  beforeEach(() => {
    handlers.clear();
    db = initializeDatabase(':memory:');
    registerJobHandlers(db);

    columns = db.prepare('PRAGMA table_info(jobs)').all() as any[];

    // Populate every writable column with a distinctive value, so "copied"
    // versus "dropped" is unambiguous. Sentinels are type-appropriate; a
    // column left at its default would make a dropped copy look identical.
    const writable = columns.filter((c) => c.name !== 'id');
    const values = writable.map((c) => sentinelFor(c.name, c.type));
    parentId = Number(
      db
        .prepare(
          `INSERT INTO jobs (${writable.map((c) => c.name).join(', ')})
           VALUES (${writable.map(() => '?').join(', ')})`,
        )
        .run(...values).lastInsertRowid,
    );
  });

  function sentinelFor(name: string, type: string): any {
    // Columns with a constrained vocabulary need a legal value, not a sentinel.
    // CHECK constraint: draft/submitted/won/lost/archived. 'submitted' is
    // deliberately not 'draft', so a copy that resets to draft shows up as a
    // difference and has to be justified in the exempt map.
    if (name === 'status') return 'submitted';
    if (name === 'parent_job_id') return null;
    if (name === 'client_id') return null;
    if (name === 'cloud_id') return null;
    const t = (type || '').toUpperCase();
    if (t.includes('INT')) return 41;
    if (t.includes('REAL') || t.includes('NUM') || t.includes('DEC')) return 41.5;
    return `sentinel_${name}`;
  }

  function rowById(id: number): Record<string, any> {
    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
  }

  function reportDropped(
    copy: Record<string, any>,
    parent: Record<string, any>,
    exempt: Record<string, string>,
  ): string[] {
    return columns
      .map((c) => c.name)
      .filter((name) => !(name in exempt))
      .filter((name) => copy[name] !== parent[name]);
  }

  it('duplicate carries every column that is not explicitly exempt', async () => {
    const parent = rowById(parentId);
    const { newJobId } = await call('db:jobs:duplicate', parentId, 'Copied Job');
    const dropped = reportDropped(rowById(newJobId), parent, DUPLICATE_EXEMPT);

    expect(
      dropped,
      `db:jobs:duplicate did not copy: ${dropped.join(', ')}.\n` +
        'Either add these to the INSERT in src/main/ipc/jobs.ts, or add each to\n' +
        'DUPLICATE_EXEMPT in this file with the reason it should not be copied.\n' +
        'This is the check F19 asked for — do not silently widen the exempt list.',
    ).toEqual([]);
  });

  it('change order inherits every column that is not explicitly exempt', async () => {
    const parent = rowById(parentId);
    const created: any = await call('db:jobs:create-change-order', parentId);
    const coId = created?.newJobId ?? created?.id ?? created;
    const dropped = reportDropped(rowById(Number(coId)), parent, CHANGE_ORDER_EXEMPT);

    expect(
      dropped,
      `db:jobs:create-change-order did not inherit: ${dropped.join(', ')}.\n` +
        'Either add these to the INSERT in src/main/ipc/jobs.ts, or add each to\n' +
        'CHANGE_ORDER_EXEMPT in this file with the reason. F30 was exactly this\n' +
        'bug (escalation_percent), found only after it shipped.',
    ).toEqual([]);
  });

  it('change order is actually linked to its parent', async () => {
    const created: any = await call('db:jobs:create-change-order', parentId);
    const coId = Number(created?.newJobId ?? created?.id ?? created);
    const co = rowById(coId);
    expect(co.parent_job_id).toBe(parentId);
    expect(co.change_order_number).toBeTruthy();
  });

  it('the exempt lists only name columns that exist', () => {
    // Stops the lists rotting into a pile of names for dropped columns, which
    // would silently weaken the guard.
    const names = new Set(columns.map((c) => c.name));
    const stale = [...new Set([...Object.keys(DUPLICATE_EXEMPT), ...Object.keys(CHANGE_ORDER_EXEMPT)])]
      .filter((n) => !names.has(n));
    expect(stale, `exempt entries for columns that no longer exist: ${stale.join(', ')}`).toEqual([]);
  });
});
