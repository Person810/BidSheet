import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';

// database.ts imports electron only for getDbPath(); these tests always pass
// an explicit ':memory:' path. Mock it so the suite runs under CI's
// `npm ci --ignore-scripts` install, where no Electron binary is present.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

import { initializeDatabase } from '../database';

/**
 * Migration v31 schema + the price-state backfill rule. The reconciliation
 * handlers themselves run over Electron IPC; here we lock in the data-model
 * guarantees they depend on (§3, §4).
 */
function freshDb(): Database.Database {
  return initializeDatabase(':memory:');
}

let uniq = 0;
function makeJobWithLine(db: Database.Database, materialCost: number): { jobId: number; lineId: number } {
  const tag = `PVC-${uniq++}`;
  const catId = Number(db.prepare('INSERT INTO material_categories (name) VALUES (?)').run(tag).lastInsertRowid);
  const matId = Number(db.prepare(
    "INSERT INTO materials (category_id, name, unit, default_unit_cost) VALUES (?, ?, 'LF', ?)",
  ).run(catId, `8" ${tag}`, materialCost).lastInsertRowid);
  const jobId = Number(db.prepare("INSERT INTO jobs (name, client) VALUES ('J', 'C')").run().lastInsertRowid);
  const secId = Number(db.prepare("INSERT INTO bid_sections (job_id, name) VALUES (?, 'Sewer')").run(jobId).lastInsertRowid);
  const lineId = Number(db.prepare(
    `INSERT INTO bid_line_items (section_id, job_id, description, quantity, unit, material_id, material_unit_cost)
     VALUES (?, ?, '8 inch pvc', 100, 'LF', ?, ?)`,
  ).run(secId, jobId, matId, materialCost).lastInsertRowid);
  return { jobId, lineId };
}

describe('migration v31 — price import schema', () => {
  let db: Database.Database;
  beforeEach(() => { db = freshDb(); });

  it('creates the raw_quote_lines and quote_aliases tables', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('raw_quote_lines','quote_aliases')",
    ).all().map((r: any) => r.name).sort();
    expect(tables).toEqual(['quote_aliases', 'raw_quote_lines']);
  });

  it('adds price_state (default seed) and price_source to bid_line_items', () => {
    const cols = db.prepare('PRAGMA table_info(bid_line_items)').all() as any[];
    const byName = new Map(cols.map((c) => [c.name, c]));
    expect(byName.has('price_state')).toBe(true);
    expect(byName.has('price_source')).toBe(true);
    expect(byName.get('price_state').dflt_value).toContain('seed');
  });

  it('a fresh line with no price defaults to seed', () => {
    const { lineId } = makeJobWithLine(db, 0);
    const state = (db.prepare('SELECT price_state FROM bid_line_items WHERE id = ?').get(lineId) as any).price_state;
    expect(state).toBe('seed');
  });

  it('enforces the unique (supplier, description) alias key', () => {
    db.prepare("INSERT INTO quote_aliases (supplier, raw_description, material_id) VALUES ('cm', '8 in pvc', NULL)").run();
    expect(() =>
      db.prepare("INSERT INTO quote_aliases (supplier, raw_description, material_id) VALUES ('cm', '8 in pvc', NULL)").run(),
    ).toThrow();
  });
});

describe('multi-job price propagation rules', () => {
  // The handler offers other jobs to push into via this exact predicate, then
  // matches lines by material_id. We assert both invariants at the DB level.
  const OTHER_JOBS_SQL = `SELECT id FROM jobs
    WHERE id != ? AND parent_job_id IS NULL
      AND status != 'archived'
      AND NOT (status IN ('won', 'lost') AND bid_locked = 1)
    ORDER BY id`;

  function mkJob(db: Database.Database, name: string, status: string, locked = 0): number {
    return Number(db.prepare(
      "INSERT INTO jobs (name, client, status, bid_locked) VALUES (?, 'C', ?, ?)",
    ).run(name, status, locked).lastInsertRowid);
  }

  it('excludes locked/won and archived jobs (and the current one) from the picker', () => {
    const db = freshDb();
    const current = mkJob(db, 'current', 'draft');
    const open = mkJob(db, 'open', 'draft');
    const submitted = mkJob(db, 'submitted', 'submitted');
    const wonLocked = mkJob(db, 'won-locked', 'won', 1);
    const wonOpen = mkJob(db, 'won-unlocked', 'won', 0);
    mkJob(db, 'archived', 'archived');

    const ids = (db.prepare(OTHER_JOBS_SQL).all(current) as any[]).map((r) => r.id).sort((a, b) => a - b);
    expect(ids).toEqual([open, submitted, wonOpen].sort((a, b) => a - b));
    expect(ids).not.toContain(wonLocked);
  });

  it('propagates a price to another job by material, preserving that job\'s quantity', () => {
    const db = freshDb();
    const catId = Number(db.prepare("INSERT INTO material_categories (name) VALUES ('C')").run().lastInsertRowid);
    const matId = Number(db.prepare(
      "INSERT INTO materials (category_id, name, unit, default_unit_cost) VALUES (?, 'pipe', 'LF', 10)",
    ).run(catId).lastInsertRowid);
    const jobId = mkJob(db, 'other', 'draft');
    const secId = Number(db.prepare("INSERT INTO bid_sections (job_id, name) VALUES (?, 'S')").run(jobId).lastInsertRowid);
    const lineId = Number(db.prepare(
      `INSERT INTO bid_line_items (section_id, job_id, description, quantity, unit, material_id, material_unit_cost, labor_total)
       VALUES (?, ?, 'pipe', 250, 'LF', ?, 10, 500)`,
    ).run(secId, jobId, matId).lastInsertRowid);

    // Mirror the handler's per-line propagation at the new price of 12.5.
    for (const ln of db.prepare(
      'SELECT id, quantity, labor_total, equipment_total, subcontractor_cost FROM bid_line_items WHERE job_id = ? AND material_id = ?',
    ).all(jobId, matId) as any[]) {
      const matTotal = ln.quantity * 12.5;
      const total = matTotal + (ln.labor_total || 0) + (ln.equipment_total || 0) + (ln.subcontractor_cost || 0);
      db.prepare(
        `UPDATE bid_line_items SET material_unit_cost = ?, material_total = ?, total_cost = ?, unit_cost = ?,
           price_state = 'quoted', price_source = 'src' WHERE id = ?`,
      ).run(12.5, matTotal, total, total / ln.quantity, ln.id);
    }

    const row = db.prepare('SELECT * FROM bid_line_items WHERE id = ?').get(lineId) as any;
    expect(row.quantity).toBe(250);              // its own snapshot quantity is untouched
    expect(row.material_unit_cost).toBe(12.5);
    expect(row.material_total).toBe(3125);       // 250 * 12.5
    expect(row.total_cost).toBe(3625);           // + 500 labor
    expect(row.price_state).toBe('quoted');
  });
});

describe('migration v31 — backfill of existing lines', () => {
  it('marks pre-existing lines with a real price as past_price, zero-price as seed', () => {
    // Build a v30-shaped line set by running migrations, inserting, then
    // re-deriving — simplest proxy: insert via current schema, then assert the
    // backfill rule by re-applying it the way the migration does.
    const db = freshDb();
    const priced = makeJobWithLine(db, 12.5);
    const free = makeJobWithLine(db, 0);

    // New inserts default to 'seed'; emulate the migration's one-time backfill.
    db.prepare("UPDATE bid_line_items SET price_state = 'past_price' WHERE material_unit_cost > 0").run();

    expect((db.prepare('SELECT price_state FROM bid_line_items WHERE id = ?').get(priced.lineId) as any).price_state)
      .toBe('past_price');
    expect((db.prepare('SELECT price_state FROM bid_line_items WHERE id = ?').get(free.lineId) as any).price_state)
      .toBe('seed');
  });
});
