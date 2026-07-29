import { describe, it, expect, vi, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', whenReady: () => Promise.resolve() },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

import { MIGRATIONS, initializeDatabase } from './database';

/**
 * Pins the migration numbering contract: MIGRATIONS[i] must write version i+1,
 * exactly once, with no gaps and no duplicates.
 *
 * This closes the open half of audit F25. F25 was REFUTED as a bug — every
 * version 1..N really is written exactly once on main, so nothing is broken
 * today — but the reviewer's underlying point stood: the contract is enforced
 * by nothing, and two unmerged branches now both want the same slot. A4
 * (locale persistence) and F1 (PR #129, HDD multi-bore) each need V51, and
 * whichever lands second has to renumber.
 *
 * If both merge carrying a hand-written `INSERT INTO schema_version VALUES
 * (51)`, `runMigrations` walks `for (v = version + 1; v <= MIGRATIONS.length;
 * v++)` and the second write hits the PRIMARY KEY on `version` — inside the
 * migration transaction, on every launch, for every install including fresh
 * ones. The open-items list says to track that risk in A4 and F1. With this
 * test it does not need tracking: the collision fails CI on the merge that
 * creates it, which is the one moment it is cheap to fix.
 */
describe('migration numbering contract', () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const f of tempFiles.splice(0)) {
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.unlinkSync(f + suffix); } catch { /* already gone */ }
      }
    }
  });

  function tempDbPath(label: string): string {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bidsheet-mig-')), `${label}.db`);
    tempFiles.push(p);
    return p;
  }

  function versionsIn(db: Database.Database): number[] {
    const rows = db.prepare('SELECT version FROM schema_version ORDER BY version').all() as Array<{ version: number }>;
    return rows.map((r) => r.version);
  }

  it('writes exactly one row per migration, 1..N, with no gaps or duplicates', () => {
    const db = initializeDatabase(':memory:');
    // Deep-equal against the full expected sequence rather than checking count
    // and max separately: that catches a gap, a duplicate, an out-of-order
    // write and a migration that writes no version at all, in one assertion.
    expect(versionsIn(db)).toEqual(Array.from({ length: MIGRATIONS.length }, (_, i) => i + 1));
    db.close();
  });

  it('each migration writes its own index, applied one at a time', () => {
    // The check above passes even if migration 30 wrote version 31 and 31 wrote
    // 30 — the sorted set would still be complete. Applying them individually
    // pins MIGRATIONS[i] -> i+1 specifically, which is the contract the
    // runMigrations loop depends on.
    const db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');

    for (let v = 1; v <= MIGRATIONS.length; v++) {
      db.transaction(() => MIGRATIONS[v - 1](db))();
      const max = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number };
      expect(max.v, `MIGRATIONS[${v - 1}] should write schema version ${v}`).toBe(v);
    }
    db.close();
  });

  it('a second launch on an already-migrated database applies nothing and throws nothing', () => {
    // The realistic form of the F25 failure: not a fresh install, but the next
    // time an existing user opens the app.
    const dbPath = tempDbPath('relaunch');
    const first = initializeDatabase(dbPath);
    const before = versionsIn(first);
    first.close();

    let second: Database.Database | undefined;
    expect(() => { second = initializeDatabase(dbPath); }).not.toThrow();
    expect(versionsIn(second!)).toEqual(before);
    second!.close();
  });
});
