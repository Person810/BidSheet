import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// material-categories.ts pulls seedUuid from database.ts, which imports
// electron only for getDbPath(). This suite drives its own in-memory DB, so
// the mock only needs to exist.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

import { seedUuid } from '../database';
import {
  normalizeCategoryName,
  validateCategoryName,
  createMaterialCategory,
  updateMaterialCategory,
  getMaterialCategoryUsage,
  listMaterialCategoriesWithUsage,
  deleteMaterialCategory,
  restoreMaterialCategory,
  listMaterialsByCategoryName,
} from './material-categories';

let db: Database.Database;

function createTestDb(): Database.Database {
  const tdb = new Database(':memory:');
  tdb.pragma('foreign_keys = ON');

  tdb.exec(`
    CREATE TABLE material_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_seed INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      uuid TEXT
    );

    CREATE TABLE materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL REFERENCES material_categories(id),
      name TEXT NOT NULL,
      description TEXT,
      unit TEXT NOT NULL DEFAULT 'EA',
      default_unit_cost REAL NOT NULL DEFAULT 0,
      supplier TEXT,
      part_number TEXT,
      last_price_update TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      aliases TEXT,
      tons_per_cy REAL,
      cost_per_cy REAL
    );
  `);

  tdb.exec(`
    INSERT INTO material_categories (name, description, is_seed) VALUES 
      ('Pipe', 'Pipe materials', 1),
      ('Fittings', 'Fittings materials', 1),
      ('Valves', 'Valves materials', 0);

    INSERT INTO materials (category_id, name) VALUES 
      (1, '8" PVC Pipe'),
      (1, '6" PVC Pipe'),
      (2, '8" 45 Deg Bend'),
      (3, '8" Gate Valve');
  `);

  return tdb;
}

beforeEach(() => {
  db = createTestDb();
});

describe('Smoke test', () => {
  it('creates test db properly', () => {
    const categories = db.prepare('SELECT * FROM material_categories').all();
    expect(categories.length).toBe(3);
    const materials = db.prepare('SELECT * FROM materials').all();
    expect(materials.length).toBe(4);
  });
});

describe('normalizeCategoryName', () => {
  it('trims whitespace', () => {
    const result = normalizeCategoryName('  Pipe  ');
    expect(result.displayName).toBe('Pipe');
  });

  it('applies NFKC normalization', () => {
    // Cafe\u0301 (decomposed) → Café (composed)
    const result = normalizeCategoryName('Cafe\u0301');
    expect(result.displayName).toBe('Café');
    expect(result.comparisonKey).toBe('café');
  });
});

describe('validateCategoryName', () => {
  it('rejects blank names', () => {
    expect(() => validateCategoryName(db, '')).toThrow();
    expect(() => validateCategoryName(db, '   ')).toThrow();
  });

  it('rejects names over 100 characters', () => {
    const longName = 'A'.repeat(101);
    expect(() => validateCategoryName(db, longName)).toThrow();
  });

  it('rejects case-insensitive duplicates', () => {
    // 'Pipe' exists in seed data
    expect(() => validateCategoryName(db, 'pipe')).toThrow();
    expect(() => validateCategoryName(db, 'PIPE')).toThrow();
  });

  it('allows the same name when excludeId matches', () => {
    const pipeId = (db.prepare("SELECT id FROM material_categories WHERE name = 'Pipe'").get() as any).id;
    expect(() => validateCategoryName(db, 'Pipe', pipeId)).not.toThrow();
  });
});

describe('createMaterialCategory', () => {
  it('inserts and returns the new row', () => {
    const result = createMaterialCategory(db, { name: 'New Category' });
    expect(result.id).toBeGreaterThan(0);
    expect(result.name).toBe('New Category');
  });

  it('trims the name', () => {
    const result = createMaterialCategory(db, { name: '  Trimmed  ' });
    expect(result.name).toBe('Trimmed');
  });

  it('rejects case-insensitive duplicates', () => {
    expect(() => createMaterialCategory(db, { name: 'pipe' })).toThrow();
  });
});

describe('updateMaterialCategory', () => {
  it('updates name and description preserving material assignments', () => {
    const pipeId = (db.prepare("SELECT id FROM material_categories WHERE name = 'Pipe'").get() as any).id;
    const materialsBefore = (db.prepare('SELECT COUNT(*) as count FROM materials WHERE category_id = ?').get(pipeId) as any).count;
    
    const result = updateMaterialCategory(db, { id: pipeId, name: 'PVC Pipe', description: 'Updated' });
    expect(result.name).toBe('PVC Pipe');
    
    const materialsAfter = (db.prepare('SELECT COUNT(*) as count FROM materials WHERE category_id = ?').get(pipeId) as any).count;
    expect(materialsAfter).toBe(materialsBefore);
  });

  it('rejects rename to existing name (case-insensitive)', () => {
    const pipeId = (db.prepare("SELECT id FROM material_categories WHERE name = 'Pipe'").get() as any).id;
    expect(() => updateMaterialCategory(db, { id: pipeId, name: 'fittings' })).toThrow();
  });

  it('works for seed categories', () => {
    // Mark a category as seed
    db.prepare("UPDATE material_categories SET is_seed = 1 WHERE name = 'Pipe'").run();
    const pipeId = (db.prepare("SELECT id FROM material_categories WHERE name = 'Pipe'").get() as any).id;
    const result = updateMaterialCategory(db, { id: pipeId, name: 'PVC Pipe Renamed' });
    expect(result.name).toBe('PVC Pipe Renamed');
  });
});

describe('getMaterialCategoryUsage', () => {
  it('counts materials in a category', () => {
    const pipeId = (db.prepare("SELECT id FROM material_categories WHERE name = 'Pipe'").get() as any).id;
    const usage = getMaterialCategoryUsage(db, pipeId);
    expect(usage.categoryId).toBe(pipeId);
    expect(usage.materialCount).toBe(2);
  });
});

describe('listMaterialCategoriesWithUsage', () => {
  it('lists all categories with counts', () => {
    const list = listMaterialCategoriesWithUsage(db);
    expect(list.length).toBe(3);
    const pipe = list.find(c => c.name === 'Pipe');
    expect(pipe?.materialCount).toBe(2);
    const valves = list.find(c => c.name === 'Valves');
    expect(valves?.materialCount).toBe(1);
  });
});

describe('deleteMaterialCategory', () => {
  const idOf = (name: string): number =>
    (db.prepare('SELECT id FROM material_categories WHERE name = ?').get(name) as any).id;
  const isActive = (id: number): number =>
    (db.prepare('SELECT is_active FROM material_categories WHERE id = ?').get(id) as any).is_active;

  it('hides an empty category instead of destroying the row', () => {
    // Soft delete, not DELETE: a missing row can't propagate through catalog
    // sync (see the note on deleteMaterialCategory), and it left no undo.
    const cat = createMaterialCategory(db, { name: 'Empty' });
    const result = deleteMaterialCategory(db, { categoryId: cat.id, replacementCategoryId: null, expectedMaterialCount: 0 });
    expect(result.deletedCategoryId).toBe(cat.id);
    expect(result.reassignedMaterialCount).toBe(0);
    expect(isActive(cat.id)).toBe(0);
  });

  it('reassigns populated category', () => {
    const pipeId = idOf('Pipe');
    const valvesId = idOf('Valves');
    const result = deleteMaterialCategory(db, { categoryId: pipeId, replacementCategoryId: valvesId, expectedMaterialCount: 2 });
    expect(result.deletedCategoryId).toBe(pipeId);
    expect(result.reassignedMaterialCount).toBe(2);
    expect(isActive(pipeId)).toBe(0);
    const usage = getMaterialCategoryUsage(db, valvesId);
    expect(usage.materialCount).toBe(3); // 1 + 2
  });

  it('rejects stale count', () => {
    expect(() => deleteMaterialCategory(db, { categoryId: idOf('Pipe'), replacementCategoryId: null, expectedMaterialCount: 0 })).toThrow();
  });

  it('rejects same category replacement', () => {
    const pipeId = idOf('Pipe');
    expect(() => deleteMaterialCategory(db, { categoryId: pipeId, replacementCategoryId: pipeId, expectedMaterialCount: 2 })).toThrow();
  });

  it('rejects a replacement that is itself hidden', () => {
    const valvesId = idOf('Valves');
    db.prepare('UPDATE materials SET category_id = ? WHERE category_id = ?').run(idOf('Pipe'), valvesId);
    deleteMaterialCategory(db, { categoryId: valvesId, replacementCategoryId: null, expectedMaterialCount: 0 });
    expect(() =>
      deleteMaterialCategory(db, { categoryId: idOf('Pipe'), replacementCategoryId: valvesId, expectedMaterialCount: 3 })
    ).toThrow(/replacement category no longer exists/);
  });

  it('rejects last category, counting only the visible ones', () => {
    const pipeId = idOf('Pipe');
    // Move all materials to Pipe, then hide the other categories
    db.prepare('UPDATE materials SET category_id = ?').run(pipeId);
    db.prepare("UPDATE material_categories SET is_active = 0 WHERE name != 'Pipe'").run();
    const materialCount = (db.prepare('SELECT COUNT(*) as count FROM materials WHERE category_id = ?').get(pipeId) as any).count;
    expect(() => deleteMaterialCategory(db, { categoryId: pipeId, replacementCategoryId: null, expectedMaterialCount: materialCount })).toThrow(/last material category/);
  });
});

describe('restoreMaterialCategory', () => {
  it('brings a hidden category back', () => {
    const cat = createMaterialCategory(db, { name: 'Empty' });
    deleteMaterialCategory(db, { categoryId: cat.id, replacementCategoryId: null, expectedMaterialCount: 0 });
    const restored = restoreMaterialCategory(db, cat.id);
    expect(restored.is_active).toBe(1);
  });

  it('throws for an id that was never there', () => {
    expect(() => restoreMaterialCategory(db, 9999)).toThrow(/not found/);
  });
});

describe('listMaterialCategoriesWithUsage visibility', () => {
  it('hides soft-deleted categories by default and shows them on request', () => {
    const cat = createMaterialCategory(db, { name: 'Empty' });
    deleteMaterialCategory(db, { categoryId: cat.id, replacementCategoryId: null, expectedMaterialCount: 0 });

    expect(listMaterialCategoriesWithUsage(db).some((c) => c.name === 'Empty')).toBe(false);
    expect(listMaterialCategoriesWithUsage(db, true).some((c) => c.name === 'Empty')).toBe(true);
  });
});

describe('listMaterialsByCategoryName', () => {
  const setSeedUuid = (name: string) => {
    db.prepare('UPDATE material_categories SET uuid = ? WHERE name = ?')
      .run(seedUuid('material_categories', name), name);
  };

  it('finds materials by category name', () => {
    const rows = listMaterialsByCategoryName(db, 'Pipe') as any[];
    expect(rows.map((r) => r.name).sort()).toEqual(['6" PVC Pipe', '8" PVC Pipe']);
  });

  it('still finds a seeded category after it has been renamed', () => {
    // The trench module asks for "Bedding & Backfill" and "PVC Pipe" by name.
    // Categories became renameable in #115, so a rename used to empty those
    // pickers silently — the seed uuid is what keeps the link.
    setSeedUuid('Pipe');
    updateMaterialCategory(db, {
      id: (db.prepare("SELECT id FROM material_categories WHERE name = 'Pipe'").get() as any).id,
      name: 'PVC Pipe (mine)',
    });

    const rows = listMaterialsByCategoryName(db, 'Pipe') as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].category_name).toBe('PVC Pipe (mine)');
  });

  it('excludes archived materials', () => {
    db.prepare("UPDATE materials SET is_active = 0 WHERE name = '8\" PVC Pipe'").run();
    expect(listMaterialsByCategoryName(db, 'Pipe')).toHaveLength(1);
  });

  it('returns nothing for a category no one has', () => {
    expect(listMaterialsByCategoryName(db, 'Nonexistent')).toEqual([]);
  });
});

describe('validateCategoryName against hidden categories', () => {
  it('points at the restore path rather than a dead end', () => {
    const cat = createMaterialCategory(db, { name: 'Empty' });
    deleteMaterialCategory(db, { categoryId: cat.id, replacementCategoryId: null, expectedMaterialCount: 0 });
    expect(() => createMaterialCategory(db, { name: 'empty' })).toThrow(/hidden category/i);
  });
});
