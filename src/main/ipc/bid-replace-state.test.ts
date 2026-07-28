import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';

/**
 * db:bid:replace-state is the undo/redo write path: it deletes every section
 * and line item under a job and re-inserts the snapshot. That makes it the
 * most destructive handler in the app, and the one place where "which job did
 * this snapshot come from" has to be checked.
 */
const handlers = new Map<string, (event: any, ...args: any[]) => any>();

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', whenReady: () => Promise.resolve() },
  ipcMain: { handle: (channel: string, fn: any) => handlers.set(channel, fn) },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

import { initializeDatabase } from '../database';
import { registerBidHandlers } from './bids';

const call = (channel: string, ...args: any[]) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return fn(null, ...args);
};

describe('db:bid:replace-state cross-job guard', () => {
  let db: Database.Database;
  let parentId: number;
  let coId: number;

  beforeEach(() => {
    handlers.clear();
    db = initializeDatabase(':memory:');
    registerBidHandlers(db);
    const mkJob = (name: string) =>
      Number(db.prepare(`INSERT INTO jobs (name, client) VALUES (?, 'Boh Bros')`).run(name)
        .lastInsertRowid);
    parentId = mkJob('Airport Taxiway');
    coId = mkJob('CO #1');
  });

  const seedSection = (jobId: number, name: string) => {
    const id = Number(
      db.prepare(
        `INSERT INTO bid_sections (job_id, name, sort_order) VALUES (?, ?, 0)`
      ).run(jobId, name).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO bid_line_items (job_id, section_id, description, unit, quantity, sort_order, total_cost)
       VALUES (?, ?, 'Storm pipe', 'LF', 100, 0, 25000)`
    ).run(jobId, id);
    return id;
  };

  it("refuses a snapshot captured from another job", async () => {
    const parentSection = seedSection(parentId, 'Parent Base Bid');
    seedSection(coId, 'CO Base Bid');

    // Exactly what a stale undo stack held: the PARENT's rows, replayed onto
    // the change order the user switched to.
    const parentSnapshot = {
      sections: db.prepare('SELECT * FROM bid_sections WHERE job_id = ?').all(parentId),
      lineItems: {
        [parentSection]: db
          .prepare('SELECT * FROM bid_line_items WHERE section_id = ?')
          .all(parentSection),
      },
    };

    await expect(call('db:bid:replace-state', coId, parentSnapshot)).rejects.toThrow(
      /Refusing to restore a snapshot from job/
    );

    // The change order still has its own estimate — nothing was deleted.
    const coSections = db.prepare('SELECT name FROM bid_sections WHERE job_id = ?').all(coId) as any[];
    expect(coSections).toEqual([{ name: 'CO Base Bid' }]);
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM bid_line_items WHERE job_id = ?').get(coId)
    ).toEqual({ n: 1 });
  });

  it('still restores a snapshot onto the job it came from', async () => {
    const sectionId = seedSection(parentId, 'Parent Base Bid');
    const snapshot = {
      sections: db.prepare('SELECT * FROM bid_sections WHERE job_id = ?').all(parentId),
      lineItems: {
        [sectionId]: db.prepare('SELECT * FROM bid_line_items WHERE section_id = ?').all(sectionId),
      },
    };
    // Simulate the deletion the user is undoing.
    db.prepare('DELETE FROM bid_line_items WHERE job_id = ?').run(parentId);
    db.prepare('DELETE FROM bid_sections WHERE job_id = ?').run(parentId);

    await call('db:bid:replace-state', parentId, snapshot);

    expect(
      db.prepare('SELECT name FROM bid_sections WHERE job_id = ?').all(parentId)
    ).toEqual([{ name: 'Parent Base Bid' }]);
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM bid_line_items WHERE job_id = ?').get(parentId)
    ).toEqual({ n: 1 });
  });
});
