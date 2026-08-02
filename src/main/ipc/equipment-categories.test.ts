import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  listEquipmentCategories,
  listEquipmentCategoriesWithUsage,
  saveEquipmentCategory,
  deleteEquipmentCategory,
  clearUnusedEquipmentCategories,
  adoptUsedEquipmentCategories,
} from './equipment-categories';
import { DEFAULT_EQUIPMENT_CATEGORIES } from '../../shared/equipmentCategories';

let db: Database.Database;

function createTestDb(): Database.Database {
  const tdb = new Database(':memory:');
  tdb.exec(`
    CREATE TABLE app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      equipment_categories TEXT
    );

    CREATE TABLE equipment (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL,
      category  TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    INSERT INTO app_settings (id, equipment_categories) VALUES (1, NULL);
  `);
  return tdb;
}

/** The stored column, which is what actually syncs. */
function storedColumn(): string | null {
  return (db.prepare('SELECT equipment_categories FROM app_settings WHERE id = 1').get() as any)
    .equipment_categories;
}

function addEquipment(name: string, category: string, isActive = 1): void {
  db.prepare('INSERT INTO equipment (name, category, is_active) VALUES (?, ?, ?)').run(
    name, category, isActive
  );
}

function categoryOf(name: string): string {
  return (db.prepare('SELECT category FROM equipment WHERE name = ?').get(name) as any).category;
}

beforeEach(() => {
  db = createTestDb();
});

describe('listEquipmentCategories', () => {
  it('offers the built-in defaults on a fresh install', () => {
    expect(listEquipmentCategories(db)).toEqual(
      [...DEFAULT_EQUIPMENT_CATEGORIES].sort((a, b) => a.localeCompare(b, 'en-US', { sensitivity: 'base' }))
    );
  });

  it('includes a category only equipment knows about', () => {
    db.prepare("UPDATE app_settings SET equipment_categories = 'Truck' WHERE id = 1").run();
    addEquipment('Vac Trailer', 'Hydro Excavation');
    expect(listEquipmentCategories(db)).toEqual(['Hydro Excavation', 'Truck']);
  });
});

describe('listEquipmentCategoriesWithUsage', () => {
  it('counts equipment, archived rows included, and flags unlisted ones', () => {
    db.prepare("UPDATE app_settings SET equipment_categories = 'Truck' WHERE id = 1").run();
    addEquipment('Dump Truck', 'Truck');
    addEquipment('Retired Truck', 'Truck', 0);
    addEquipment('Vac Trailer', 'Hydro Excavation');

    const rows = listEquipmentCategoriesWithUsage(db);
    const truck = rows.find((r) => r.name === 'Truck')!;
    expect(truck.equipmentCount).toBe(2);
    expect(truck.activeEquipmentCount).toBe(1);
    expect(truck.listed).toBe(true);

    const hydro = rows.find((r) => r.name === 'Hydro Excavation')!;
    expect(hydro.equipmentCount).toBe(1);
    expect(hydro.listed).toBe(false);
  });

  it('folds two spellings of one name into a single row', () => {
    db.prepare("UPDATE app_settings SET equipment_categories = 'Truck' WHERE id = 1").run();
    addEquipment('Dump Truck', 'Truck');
    addEquipment('Flatbed', 'truck');

    const rows = listEquipmentCategoriesWithUsage(db);
    expect(rows.filter((r) => r.name.toLowerCase() === 'truck')).toHaveLength(1);
    expect(rows.find((r) => r.name.toLowerCase() === 'truck')!.equipmentCount).toBe(2);
  });
});

describe('saveEquipmentCategory (add)', () => {
  it('adds to the list and persists the defaults alongside it', () => {
    const result = saveEquipmentCategory(db, { name: 'Hydro Excavation' });
    expect(result.categories).toContain('Hydro Excavation');
    // The defaults were what the user saw, so they get written down too —
    // otherwise adding one category would silently delete the other fifteen.
    expect(storedColumn()).toContain('Excavator');
    expect(storedColumn()).toContain('Hydro Excavation');
  });

  it('rejects a case-insensitive duplicate of a listed category', () => {
    expect(() => saveEquipmentCategory(db, { name: 'excavator' })).toThrow(/already exists/);
  });

  it('rejects a duplicate of an in-use category that is not on the list', () => {
    db.prepare("UPDATE app_settings SET equipment_categories = '' WHERE id = 1").run();
    addEquipment('Vac Trailer', 'Hydro Excavation');
    expect(() => saveEquipmentCategory(db, { name: 'hydro excavation' })).toThrow(/already exists/);
  });

  it('rejects a blank name', () => {
    expect(() => saveEquipmentCategory(db, { name: '   ' })).toThrow(/required/);
  });
});

describe('saveEquipmentCategory (rename)', () => {
  it('moves the equipment with the category', () => {
    addEquipment('CAT 320', 'Excavator');
    const result = saveEquipmentCategory(db, { name: 'Excavators', previousName: 'Excavator' });

    expect(result.equipmentUpdated).toBe(1);
    expect(categoryOf('CAT 320')).toBe('Excavators');
    expect(result.categories).toContain('Excavators');
    expect(result.categories).not.toContain('Excavator');
  });

  it('moves rows stored under a different spelling too', () => {
    addEquipment('CAT 320', 'excavator');
    saveEquipmentCategory(db, { name: 'Excavators', previousName: 'Excavator' });
    expect(categoryOf('CAT 320')).toBe('Excavators');
  });

  it('allows a pure case change of the same name', () => {
    addEquipment('CAT 320', 'Excavator');
    const result = saveEquipmentCategory(db, { name: 'EXCAVATOR', previousName: 'Excavator' });
    expect(result.categories).toContain('EXCAVATOR');
    expect(categoryOf('CAT 320')).toBe('EXCAVATOR');
  });

  it('rejects a rename onto another existing category', () => {
    expect(() => saveEquipmentCategory(db, { name: 'Loader', previousName: 'Excavator' }))
      .toThrow(/already exists/);
  });

  it('rejects renaming something that is gone', () => {
    db.prepare("UPDATE app_settings SET equipment_categories = 'Truck' WHERE id = 1").run();
    expect(() => saveEquipmentCategory(db, { name: 'Diggers', previousName: 'Excavator' }))
      .toThrow(/no longer exists/);
  });

  it('adopts an in-use-but-unlisted category when renaming it', () => {
    db.prepare("UPDATE app_settings SET equipment_categories = 'Truck' WHERE id = 1").run();
    addEquipment('Vac Trailer', 'Hydro Ex');
    const result = saveEquipmentCategory(db, { name: 'Hydro Excavation', previousName: 'Hydro Ex' });
    expect(categoryOf('Vac Trailer')).toBe('Hydro Excavation');
    expect(storedColumn()).toBe('Truck,Hydro Excavation');
  });
});

describe('deleteEquipmentCategory', () => {
  it('removes an unused category', () => {
    const result = deleteEquipmentCategory(db, {
      name: 'Plow', replacementName: null, expectedEquipmentCount: 0,
    });
    expect(result.deletedName).toBe('Plow');
    expect(result.reassignedEquipmentCount).toBe(0);
    expect(result.categories).not.toContain('Plow');
  });

  it('reassigns equipment to the replacement', () => {
    addEquipment('CAT 320', 'Excavator');
    addEquipment('CAT 336', 'Excavator');
    const result = deleteEquipmentCategory(db, {
      name: 'Excavator', replacementName: 'Loader', expectedEquipmentCount: 2,
    });

    expect(result.reassignedEquipmentCount).toBe(2);
    expect(categoryOf('CAT 320')).toBe('Loader');
    expect(categoryOf('CAT 336')).toBe('Loader');
    expect(result.categories).not.toContain('Excavator');
  });

  it('refuses to strand equipment when no replacement is given', () => {
    addEquipment('CAT 320', 'Excavator');
    expect(() =>
      deleteEquipmentCategory(db, {
        name: 'Excavator', replacementName: null, expectedEquipmentCount: 1,
      })
    ).toThrow(/without a replacement/);
  });

  it('refuses when the count moved underneath the user', () => {
    addEquipment('CAT 320', 'Excavator');
    expect(() =>
      deleteEquipmentCategory(db, {
        name: 'Excavator', replacementName: 'Loader', expectedEquipmentCount: 0,
      })
    ).toThrow(/count has changed/);
  });

  it('rejects a replacement that is the same category', () => {
    expect(() =>
      deleteEquipmentCategory(db, {
        name: 'Excavator', replacementName: 'excavator', expectedEquipmentCount: 0,
      })
    ).toThrow(/cannot be the same/);
  });

  it('rejects a replacement that no longer exists', () => {
    addEquipment('CAT 320', 'Excavator');
    expect(() =>
      deleteEquipmentCategory(db, {
        name: 'Excavator', replacementName: 'Nonexistent', expectedEquipmentCount: 1,
      })
    ).toThrow(/replacement category no longer exists/);
  });

  it('leaves nothing behind when every category is deleted', () => {
    // The blank-database case from #107: an install that manages its own
    // catalog must be able to end up with no categories at all.
    for (const name of DEFAULT_EQUIPMENT_CATEGORIES) {
      deleteEquipmentCategory(db, { name, replacementName: null, expectedEquipmentCount: 0 });
    }
    expect(listEquipmentCategories(db)).toEqual([]);
    expect(storedColumn()).toBe('');
  });
});

describe('clearUnusedEquipmentCategories', () => {
  it('keeps only what equipment is actually using', () => {
    addEquipment('CAT 320', 'Excavator');
    const result = clearUnusedEquipmentCategories(db);
    expect(result.categories).toEqual(['Excavator']);
    expect(result.removed).toBe(DEFAULT_EQUIPMENT_CATEGORIES.length - 1);
  });

  it('empties the list entirely when nothing is in use', () => {
    const result = clearUnusedEquipmentCategories(db);
    expect(result.categories).toEqual([]);
    expect(storedColumn()).toBe('');
  });
});

describe('adoptUsedEquipmentCategories', () => {
  it('puts in-use-but-unlisted categories on the list', () => {
    db.prepare("UPDATE app_settings SET equipment_categories = 'Truck' WHERE id = 1").run();
    addEquipment('Vac Trailer', 'Hydro Excavation');

    const result = adoptUsedEquipmentCategories(db);
    expect(result.added).toBe(1);
    expect(listEquipmentCategoriesWithUsage(db).every((r) => r.listed)).toBe(true);
  });

  it('is a no-op when the list already covers everything', () => {
    db.prepare("UPDATE app_settings SET equipment_categories = 'Truck' WHERE id = 1").run();
    addEquipment('Dump Truck', 'Truck');
    expect(adoptUsedEquipmentCategories(db).added).toBe(0);
  });
});
