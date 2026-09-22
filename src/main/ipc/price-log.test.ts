import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';

/**
 * Pricing audit log: every path that changes a catalog price records it —
 * the inline price box, the full edit forms, and a price pulled in from
 * another seat by cloud sync — and nothing records a change that didn't
 * happen.
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
import { registerCatalogHandlers } from './catalog';
import { exportCatalog, importCatalog } from '../cloud/catalog-sync';

const call = (channel: string, ...args: any[]) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return fn(null, ...args);
};

describe('pricing audit log', () => {
  let db: Database.Database;
  let materialId: number;
  let roleId: number;
  let equipId: number;

  const materialPayload = (extra: Record<string, any> = {}) => {
    const m = db.prepare('SELECT * FROM materials WHERE id = ?').get(materialId) as any;
    return {
      id: m.id, categoryId: m.category_id, name: m.name, description: m.description, unit: m.unit,
      defaultUnitCost: m.default_unit_cost, supplier: m.supplier, partNumber: m.part_number,
      notes: m.notes, aliases: m.aliases, isActive: true, ...extra,
    };
  };

  beforeEach(() => {
    handlers.clear();
    db = initializeDatabase(':memory:');
    registerCatalogHandlers(db);
    const cat = Number(db.prepare("INSERT INTO material_categories (name) VALUES ('Pipe')").run().lastInsertRowid);
    materialId = Number(db.prepare(
      "INSERT INTO materials (category_id, name, unit, default_unit_cost, last_price_update) VALUES (?, '8\" PVC', 'LF', 7.5, '2025-01-01 00:00:00')"
    ).run(cat).lastInsertRowid);
    roleId = Number(db.prepare(
      "INSERT INTO labor_roles (name, default_hourly_rate, burden_multiplier) VALUES ('Operator', 35, 1.4)"
    ).run().lastInsertRowid);
    equipId = Number(db.prepare(
      "INSERT INTO equipment (name, category, hourly_rate, daily_rate, mobilization_cost) VALUES ('Excavator', 'Excavator', 85, 600, 250)"
    ).run().lastInsertRowid);
  });

  it('logs the inline price box and the material edit form', async () => {
    await call('db:materials:update-price', materialId, 8.25, 'Manual');
    await call('db:materials:save', materialPayload({ defaultUnitCost: 9 }));
    const log = await call('db:price-log:list', { kind: 'material', itemId: materialId });
    expect(log.map((e: any) => [e.oldValue, e.newValue, e.source])).toEqual([[8.25, 9, 'Manual'], [7.5, 8.25, 'Manual']]);
    expect(log[0].itemName).toBe('8" PVC');
  });

  it('a material edit that leaves the price alone logs nothing and keeps the price date', async () => {
    await call('db:materials:save', materialPayload({ name: '8" PVC SDR-35', aliases: 'sewer pipe' }));
    expect(await call('db:price-log:list', { kind: 'material' })).toEqual([]);
    const m = db.prepare('SELECT last_price_update FROM materials WHERE id = ?').get(materialId) as any;
    // The stale-price warning must survive a rename.
    expect(m.last_price_update).toBe('2025-01-01 00:00:00');
  });

  it('logs labor base rate and burden changes, one row per field', async () => {
    await call('db:labor-roles:save', { id: roleId, name: 'Operator', defaultHourlyRate: 38, burdenMultiplier: 1.45, notes: null });
    const log = await call('db:price-log:list', { kind: 'labor_role' });
    expect(log.map((e: any) => [e.itemName, e.field, e.oldValue, e.newValue]).sort()).toEqual([
      ['Operator', 'burden_multiplier', 1.4, 1.45],
      ['Operator', 'default_hourly_rate', 35, 38],
    ]);
  });

  it('logs equipment rate changes but not unrelated edits', async () => {
    const base = { id: equipId, name: 'Excavator', category: 'Excavator', hourlyRate: 85, dailyRate: 600, mobilizationCost: 250, isOwned: true, isActive: true };
    await call('db:equipment:save', { ...base, notes: 'CAT 320' });
    expect(await call('db:price-log:list', { kind: 'equipment' })).toEqual([]);
    await call('db:equipment:save', { ...base, hourlyRate: 95 });
    const log = await call('db:price-log:list', {});
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: 'equipment', itemName: 'Excavator', field: 'hourly_rate', oldValue: 85, newValue: 95, source: 'Manual' });
  });

  it('logs a price that arrives from another seat through cloud sync', () => {
    const snap = exportCatalog(db);
    const mat = snap.materials.find((m: any) => m.name === '8" PVC');
    mat.default_unit_cost = 11.4;
    importCatalog(db, snap);
    const rows = db.prepare('SELECT old_price, new_price, source FROM price_updates WHERE material_id = ?').all(materialId);
    expect(rows).toEqual([{ old_price: 7.5, new_price: 11.4, source: 'Cloud sync' }]);
  });
});
