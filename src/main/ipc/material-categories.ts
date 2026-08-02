import type Database from 'better-sqlite3';
import type { SaveMaterialCategoryPayload, MaterialCategoryRow, MaterialCategoryUsage, MaterialCategoryManagementRow, DeleteMaterialCategoryPayload, DeleteMaterialCategoryResult } from '../../shared/types/ipc';
import { seedUuid } from '../database';

/** Trim and NFKC-normalise a category name. */
export function normalizeCategoryName(name: string): { displayName: string; comparisonKey: string } {
  const displayName = name.trim().normalize('NFKC');
  const comparisonKey = displayName.toLocaleLowerCase('en-US');
  return { displayName, comparisonKey };
}

/** Validate a category name for create/update. */
export function validateCategoryName(db: Database.Database, name: string, excludeId?: number): void {
  const { displayName, comparisonKey } = normalizeCategoryName(name);
  if (!displayName) throw new Error('Category name is required.');
  if (displayName.length > 100) throw new Error('Category name must be 100 characters or fewer.');

  // Hidden categories are checked too — `name` is UNIQUE in the schema, so a
  // collision with one would fail at the database anyway. Saying which case
  // it is turns a dead end into an action the user can take.
  const rows = db.prepare('SELECT id, name, is_active FROM material_categories').all() as
    { id: number; name: string; is_active: number }[];
  for (const row of rows) {
    if (excludeId && row.id === excludeId) continue;
    const existingKey = row.name.trim().normalize('NFKC').toLocaleLowerCase('en-US');
    if (existingKey === comparisonKey) {
      throw new Error(
        row.is_active === 0
          ? 'A hidden category already has this name. Restore it instead of creating a new one.'
          : 'A category with this name already exists.'
      );
    }
  }
}

/** Insert a new category. */
export function createMaterialCategory(db: Database.Database, input: SaveMaterialCategoryPayload): MaterialCategoryRow {
  validateCategoryName(db, input.name);
  const { displayName } = normalizeCategoryName(input.name);
  const description = input.description?.trim() || null;
  
  const result = db.prepare(
    'INSERT INTO material_categories (name, description) VALUES (?, ?)'
  ).run(displayName, description);
  
  return db.prepare('SELECT * FROM material_categories WHERE id = ?').get(Number(result.lastInsertRowid)) as MaterialCategoryRow;
}

/** Update an existing category. */
export function updateMaterialCategory(db: Database.Database, input: SaveMaterialCategoryPayload): MaterialCategoryRow {
  if (!input.id) throw new Error('Category ID is required for update.');
  validateCategoryName(db, input.name, input.id);
  const { displayName } = normalizeCategoryName(input.name);
  const description = input.description !== undefined ? (input.description?.trim() || null) : undefined;
  
  if (description !== undefined) {
    db.prepare('UPDATE material_categories SET name = ?, description = ? WHERE id = ?').run(displayName, description, input.id);
  } else {
    db.prepare('UPDATE material_categories SET name = ? WHERE id = ?').run(displayName, input.id);
  }
  
  const row = db.prepare('SELECT * FROM material_categories WHERE id = ?').get(input.id) as MaterialCategoryRow | undefined;
  if (!row) throw new Error('Category not found.');
  return row;
}

/** Count materials in a category (active + archived). */
export function getMaterialCategoryUsage(db: Database.Database, categoryId: number): MaterialCategoryUsage {
  const row = db.prepare(
    'SELECT COUNT(*) as count FROM materials WHERE category_id = ?'
  ).get(categoryId) as { count: number };
  return { categoryId, materialCount: row.count };
}

/**
 * List categories with material counts. Hidden ones are included only when
 * asked for — the manager wants them (to offer a restore), the pickers and
 * the sidebar do not.
 */
export function listMaterialCategoriesWithUsage(
  db: Database.Database,
  includeInactive = false
): MaterialCategoryManagementRow[] {
  // Interpolated SQL is a fixed string chosen by a boolean; no user input.
  const activeFilter = includeInactive ? '' : 'WHERE mc.is_active = 1';
  return db.prepare(`
    SELECT mc.*, COALESCE(m.cnt, 0) as materialCount
    FROM material_categories mc
    LEFT JOIN (SELECT category_id, COUNT(*) as cnt FROM materials GROUP BY category_id) m
    ON mc.id = m.category_id
    ${activeFilter}
    ORDER BY mc.name COLLATE NOCASE
  `).all() as MaterialCategoryManagementRow[];
}

/**
 * Delete a category, reassigning its materials first.
 *
 * This is a soft delete (is_active = 0), like every other catalog table. A
 * hard DELETE — which is what this did when category CRUD first landed —
 * cannot propagate through catalog sync: that merge is a per-row upsert keyed
 * by uuid, so a row that is simply *absent* locally reads as "this machine
 * hasn't seen it yet" and the next push from another machine puts it back.
 * An is_active flip is an ordinary column update and merges like any other,
 * and it gives the restore path the hard delete never had.
 */
export function deleteMaterialCategory(db: Database.Database, input: DeleteMaterialCategoryPayload): DeleteMaterialCategoryResult {
  const { categoryId, replacementCategoryId, expectedMaterialCount } = input;

  if (categoryId === replacementCategoryId) {
    throw new Error('Replacement category cannot be the same as the deleted category.');
  }

  const activeCount = (db.prepare('SELECT COUNT(*) as count FROM material_categories WHERE is_active = 1').get() as { count: number }).count;
  if (activeCount <= 1) {
    throw new Error('Cannot delete the last material category.');
  }

  const usage = getMaterialCategoryUsage(db, categoryId);
  if (usage.materialCount !== expectedMaterialCount) {
    throw new Error('Material count has changed. Please refresh and try again.');
  }

  if (usage.materialCount > 0 && !replacementCategoryId) {
    throw new Error('Cannot delete a category that contains materials without a replacement category.');
  }

  if (replacementCategoryId != null) {
    const replacement = db
      .prepare('SELECT is_active FROM material_categories WHERE id = ?')
      .get(replacementCategoryId) as { is_active: number } | undefined;
    if (!replacement || replacement.is_active === 0) {
      throw new Error('The replacement category no longer exists. Please refresh and try again.');
    }
  }

  const deleteTx = db.transaction(() => {
    let reassignedCount = 0;

    if (usage.materialCount > 0 && replacementCategoryId) {
      const result = db.prepare('UPDATE materials SET category_id = ? WHERE category_id = ?').run(replacementCategoryId, categoryId);
      reassignedCount = result.changes;
    }

    db.prepare('UPDATE material_categories SET is_active = 0 WHERE id = ?').run(categoryId);

    return {
      deletedCategoryId: categoryId,
      replacementCategoryId: replacementCategoryId,
      reassignedMaterialCount: reassignedCount
    };
  });

  return deleteTx();
}

/**
 * Active materials in a category, looked up the way feature code asks for one:
 * by name.
 *
 * Also matched by the category's deterministic seed uuid, because callers are
 * hardcoded to seed names ("Bedding & Backfill", "PVC Pipe") and categories
 * became renameable. Without the uuid arm, renaming a seeded category silently
 * empties the trench module's pipe and bedding pickers — the feature just
 * quietly stops offering anything, with nothing to connect it to the rename.
 * A user-made category of the same name still matches on the name arm.
 */
export function listMaterialsByCategoryName(db: Database.Database, categoryName: string): unknown[] {
  return db
    .prepare(
      `SELECT m.*, mc.name as category_name FROM materials m
       JOIN material_categories mc ON m.category_id = mc.id
       WHERE (mc.name = ? OR mc.uuid = ?) AND m.is_active = 1 ORDER BY m.name`
    )
    .all(categoryName, seedUuid('material_categories', categoryName));
}

/**
 * Bring a hidden category back. Its materials are not moved back — they were
 * reassigned on the way out and belong to whoever holds them now — so a
 * restored category returns empty unless something was filed into it since.
 */
export function restoreMaterialCategory(db: Database.Database, categoryId: number): MaterialCategoryRow {
  const row = db.prepare('SELECT * FROM material_categories WHERE id = ?').get(categoryId) as MaterialCategoryRow | undefined;
  if (!row) throw new Error('Category not found.');
  db.prepare('UPDATE material_categories SET is_active = 1 WHERE id = ?').run(categoryId);
  return db.prepare('SELECT * FROM material_categories WHERE id = ?').get(categoryId) as MaterialCategoryRow;
}
