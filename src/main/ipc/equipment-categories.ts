/**
 * Equipment category management (#107).
 *
 * The managed list of names lives in `app_settings.equipment_categories`
 * (see shared/equipmentCategories.ts for why it isn't a table); the link
 * from a piece of equipment to its category is the free-text
 * `equipment.category` column, matched case-insensitively.
 *
 * That means a rename has to move the equipment with it and a delete has to
 * reassign — both here, in one transaction, so the list and the rows it
 * describes can never disagree halfway through.
 */

import type Database from 'better-sqlite3';
import type {
  EquipmentCategoryManagementRow,
  SaveEquipmentCategoryPayload,
  DeleteEquipmentCategoryPayload,
  DeleteEquipmentCategoryResult,
} from '../../shared/types/ipc';
import {
  cleanEquipmentCategoryName,
  equipmentCategoryKey,
  resolveEquipmentCategories,
  serializeEquipmentCategories,
  storedEquipmentCategories,
  sortEquipmentCategories,
  validateEquipmentCategoryName,
} from '../../shared/equipmentCategories';

function readStoredColumn(db: Database.Database): string | null {
  const row = db.prepare('SELECT equipment_categories FROM app_settings WHERE id = 1').get() as
    | { equipment_categories: string | null }
    | undefined;
  return row?.equipment_categories ?? null;
}

function writeStoredColumn(db: Database.Database, list: string[]): void {
  db.prepare('UPDATE app_settings SET equipment_categories = ? WHERE id = 1').run(
    serializeEquipmentCategories(list)
  );
}

/** Distinct category names actually on equipment rows, archived ones included. */
function categoriesInUse(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT DISTINCT category FROM equipment WHERE category IS NOT NULL AND trim(category) != ''")
    .all() as { category: string }[];
  return rows.map((r) => r.category);
}

/**
 * The exact `equipment.category` spellings that mean `name`.
 *
 * Matching happens here rather than in SQL on purpose: SQLite's lower() only
 * folds ASCII, so a `WHERE lower(category) = lower(?)` would treat "CAFÉ" and
 * "café" as different categories while equipmentCategoryKey treats them as
 * one — and a rename would quietly leave rows behind under the old name.
 */
function storedSpellingsOf(db: Database.Database, name: string): string[] {
  const key = equipmentCategoryKey(name);
  return categoriesInUse(db).filter((c) => equipmentCategoryKey(c) === key);
}

/** Count the equipment filed under every spelling of `name`. */
function equipmentCountFor(db: Database.Database, name: string): number {
  const spellings = storedSpellingsOf(db, name);
  if (spellings.length === 0) return 0;
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM equipment WHERE category IN (${spellings.map(() => '?').join(', ')})`
      )
      .get(...spellings) as { n: number }
  ).n;
}

/** Move every piece of equipment filed under `from` (any spelling) to `to`. */
function reassignEquipment(db: Database.Database, from: string, to: string): number {
  const spellings = storedSpellingsOf(db, from);
  if (spellings.length === 0) return 0;
  return db
    .prepare(
      `UPDATE equipment SET category = ? WHERE category IN (${spellings.map(() => '?').join(', ')})`
    )
    .run(to, ...spellings).changes;
}

/** Every category the picker should offer: the managed list ∪ what's in use. */
export function listEquipmentCategories(db: Database.Database): string[] {
  return resolveEquipmentCategories(readStoredColumn(db), categoriesInUse(db));
}

/**
 * The manager's view: every category with its equipment counts, plus whether
 * it's on the managed list. `listed: false` marks a category that only exists
 * because equipment points at it — the manager offers to adopt those.
 */
export function listEquipmentCategoriesWithUsage(
  db: Database.Database
): EquipmentCategoryManagementRow[] {
  const stored = readStoredColumn(db);
  const listedKeys = new Set(storedEquipmentCategories(stored).map(equipmentCategoryKey));

  const counts = db
    .prepare(
      `SELECT category, COUNT(*) AS total, SUM(is_active) AS active
       FROM equipment WHERE category IS NOT NULL AND trim(category) != ''
       GROUP BY category`
    )
    .all() as { category: string; total: number; active: number | null }[];

  const byKey = new Map<string, { total: number; active: number }>();
  for (const row of counts) {
    const key = equipmentCategoryKey(row.category);
    const prev = byKey.get(key) ?? { total: 0, active: 0 };
    // Two spellings of one name ("Truck"/"truck") are one category here, so
    // their counts add up rather than showing as two rows.
    byKey.set(key, { total: prev.total + row.total, active: prev.active + (row.active ?? 0) });
  }

  return resolveEquipmentCategories(stored, categoriesInUse(db)).map((name) => {
    const usage = byKey.get(equipmentCategoryKey(name)) ?? { total: 0, active: 0 };
    return {
      name,
      equipmentCount: usage.total,
      activeEquipmentCount: usage.active,
      listed: listedKeys.has(equipmentCategoryKey(name)),
    };
  });
}

/**
 * Add a category, or rename one. Renaming rewrites `equipment.category` on
 * every row that pointed at the old name (any spelling of it), so the link
 * survives; the rows are ordinary catalog updates, so the rename syncs.
 */
export function saveEquipmentCategory(
  db: Database.Database,
  input: SaveEquipmentCategoryPayload
): { categories: string[]; equipmentUpdated: number } {
  const name = cleanEquipmentCategoryName(input.name ?? '');
  const previousName = input.previousName ? cleanEquipmentCategoryName(input.previousName) : null;

  const run = db.transaction(() => {
    // Validate against everything the user can see, not just the stored list:
    // renaming onto an in-use-but-unlisted name would silently merge two
    // categories that look distinct in the manager.
    const visible = resolveEquipmentCategories(readStoredColumn(db), categoriesInUse(db));
    const error = validateEquipmentCategoryName(input.name ?? '', visible, previousName ?? undefined);
    if (error) throw new Error(error);

    const list = storedEquipmentCategories(readStoredColumn(db));
    let equipmentUpdated = 0;

    if (previousName) {
      const previousKey = equipmentCategoryKey(previousName);
      const existed = visible.some((c) => equipmentCategoryKey(c) === previousKey);
      if (!existed) throw new Error('That category no longer exists. Please refresh and try again.');

      const next = list.filter((c) => equipmentCategoryKey(c) !== previousKey);
      next.push(name);
      writeStoredColumn(db, next);

      equipmentUpdated = reassignEquipment(db, previousName, name);
    } else {
      writeStoredColumn(db, [...list, name]);
    }

    return {
      categories: resolveEquipmentCategories(readStoredColumn(db), categoriesInUse(db)),
      equipmentUpdated,
    };
  });

  return run();
}

/**
 * Delete a category. Equipment in it is reassigned to `replacementName`
 * first; a category with equipment and no replacement is refused rather than
 * left with rows pointing at a name that no longer exists.
 *
 * `expectedEquipmentCount` is the count the user was shown — if the catalog
 * moved underneath them (a sync landed, another window saved), the delete is
 * refused rather than silently reassigning more than they agreed to.
 */
export function deleteEquipmentCategory(
  db: Database.Database,
  input: DeleteEquipmentCategoryPayload
): DeleteEquipmentCategoryResult {
  const name = cleanEquipmentCategoryName(input.name ?? '');
  const replacementName = input.replacementName
    ? cleanEquipmentCategoryName(input.replacementName)
    : null;

  if (!name) throw new Error('Category name is required.');
  if (replacementName && equipmentCategoryKey(replacementName) === equipmentCategoryKey(name)) {
    throw new Error('Replacement category cannot be the same as the deleted category.');
  }

  const run = db.transaction(() => {
    const key = equipmentCategoryKey(name);
    const visible = resolveEquipmentCategories(readStoredColumn(db), categoriesInUse(db));
    if (!visible.some((c) => equipmentCategoryKey(c) === key)) {
      throw new Error('That category no longer exists. Please refresh and try again.');
    }

    const inUse = equipmentCountFor(db, name);
    if (inUse !== input.expectedEquipmentCount) {
      throw new Error('Equipment count has changed. Please refresh and try again.');
    }
    if (inUse > 0 && !replacementName) {
      throw new Error('Cannot delete a category that has equipment in it without a replacement.');
    }
    if (replacementName && !visible.some((c) => equipmentCategoryKey(c) === equipmentCategoryKey(replacementName))) {
      throw new Error('The replacement category no longer exists. Please refresh and try again.');
    }

    let reassignedEquipmentCount = 0;
    if (inUse > 0 && replacementName) {
      reassignedEquipmentCount = reassignEquipment(db, name, replacementName);
    }

    writeStoredColumn(
      db,
      storedEquipmentCategories(readStoredColumn(db)).filter((c) => equipmentCategoryKey(c) !== key)
    );

    return {
      deletedName: name,
      replacementName,
      reassignedEquipmentCount,
      categories: resolveEquipmentCategories(readStoredColumn(db), categoriesInUse(db)),
    };
  });

  return run();
}

/**
 * Drop every category no equipment is using. This is what makes "I'll manage
 * the catalog myself" workable: an install that skipped the sample catalog
 * starts with fifteen default categories it never asked for, and clearing
 * them one at a time is the kind of chore that makes people give up.
 */
export function clearUnusedEquipmentCategories(
  db: Database.Database
): { removed: number; categories: string[] } {
  const run = db.transaction(() => {
    const usedKeys = new Set(categoriesInUse(db).map(equipmentCategoryKey));
    const list = storedEquipmentCategories(readStoredColumn(db));
    const kept = list.filter((c) => usedKeys.has(equipmentCategoryKey(c)));
    writeStoredColumn(db, kept);
    return {
      removed: list.length - kept.length,
      categories: resolveEquipmentCategories(readStoredColumn(db), categoriesInUse(db)),
    };
  });
  return run();
}

/**
 * Put every in-use-but-unlisted category on the managed list. The manager
 * shows those as "in use" rows; this is the one-click way to adopt them all
 * (after a sync from a machine with a different list, typically).
 */
export function adoptUsedEquipmentCategories(
  db: Database.Database
): { added: number; categories: string[] } {
  const run = db.transaction(() => {
    const list = storedEquipmentCategories(readStoredColumn(db));
    const before = list.length;
    const merged = sortEquipmentCategories(
      resolveEquipmentCategories(serializeEquipmentCategories(list), categoriesInUse(db))
    );
    writeStoredColumn(db, merged);
    return {
      added: merged.length - before,
      categories: resolveEquipmentCategories(readStoredColumn(db), categoriesInUse(db)),
    };
  });
  return run();
}
