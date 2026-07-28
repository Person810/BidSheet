import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', whenReady: () => Promise.resolve() },
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

import { initializeDatabase, addTradeCatalog } from './database';
import type { TradeType } from '../shared/constants/seed-data';

/**
 * "Add a trade" brings in somebody else's catalog. It must not reach into the
 * catalog the estimator has been maintaining and reprice it — a blank density
 * on a user-created aggregate is a deliberate choice (bill CY lines at the raw
 * catalog price), and overwriting it moved every CY line's material cost.
 */
describe('adding a trade does not touch user-created materials', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
  });

  const userMaterial = (name: string, unit: string, price: number) => {
    const catId = Number(
      db.prepare(
        `INSERT INTO material_categories (name, is_seed) VALUES ('My Aggregates', 0)`
      ).run().lastInsertRowid
    );
    return Number(
      db.prepare(
        `INSERT INTO materials (category_id, name, unit, default_unit_cost, is_seed)
         VALUES (?, ?, ?, ?, 0)`
      ).run(catId, name, unit, price).lastInsertRowid
    );
  };

  it('leaves a deliberately blank density blank', () => {
    const id = userMaterial('Blue Rock Special', 'TON', 30);

    addTradeCatalog(db, 'storm_drain', true);

    const row = db
      .prepare('SELECT tons_per_cy, cost_per_cy, default_unit_cost FROM materials WHERE id = ?')
      .get(id) as any;
    expect(row.tons_per_cy).toBeNull();
    expect(row.cost_per_cy).toBeNull();
    expect(row.default_unit_cost).toBe(30);
  });

  it('still prices the trade\'s own seeded aggregates', () => {
    // The scoping must not break the path it exists for.
    userMaterial('Blue Rock Special', 'TON', 30);
    addTradeCatalog(db, 'storm_drain', true);

    const stone = db
      .prepare(
        `SELECT tons_per_cy, cost_per_cy, default_unit_cost FROM materials
         WHERE is_seed = 1 AND name LIKE '#57 Stone%'`
      )
      .get() as any;
    expect(stone.tons_per_cy).toBe(1.4);
    expect(stone.cost_per_cy).toBeCloseTo(stone.default_unit_cost * 1.4, 2);

    // And nothing outside the seed set was touched.
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM materials
           WHERE is_seed = 0 AND (tons_per_cy IS NOT NULL OR cost_per_cy IS NOT NULL)`
        )
        .get()
    ).toEqual({ n: 0 });
  });
});
