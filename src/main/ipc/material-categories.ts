import type Database from 'better-sqlite3';
import type { SaveMaterialCategoryPayload, MaterialCategoryRow, MaterialCategoryUsage, MaterialCategoryManagementRow, DeleteMaterialCategoryPayload, DeleteMaterialCategoryResult } from '../../shared/types/ipc';

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
  
  const rows = db.prepare('SELECT id, name FROM material_categories').all() as { id: number; name: string }[];
  for (const row of rows) {
    if (excludeId && row.id === excludeId) continue;
    const existingKey = row.name.trim().normalize('NFKC').toLocaleLowerCase('en-US');
    if (existingKey === comparisonKey) {
      throw new Error('A category with this name already exists.');
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

/** List all categories with material counts. */
export function listMaterialCategoriesWithUsage(db: Database.Database): MaterialCategoryManagementRow[] {
  return db.prepare(`
    SELECT mc.*, COALESCE(m.cnt, 0) as materialCount
    FROM material_categories mc
    LEFT JOIN (SELECT category_id, COUNT(*) as cnt FROM materials GROUP BY category_id) m
    ON mc.id = m.category_id
    ORDER BY mc.name COLLATE NOCASE
  `).all() as MaterialCategoryManagementRow[];
}

/** Delete a category, optionally reassigning materials first. */
export function deleteMaterialCategory(db: Database.Database, input: DeleteMaterialCategoryPayload): DeleteMaterialCategoryResult {
  const { categoryId, replacementCategoryId, expectedMaterialCount } = input;
  
  if (categoryId === replacementCategoryId) {
    throw new Error('Replacement category cannot be the same as the deleted category.');
  }

  const categoryCount = (db.prepare('SELECT COUNT(*) as count FROM material_categories').get() as { count: number }).count;
  if (categoryCount <= 1) {
    throw new Error('Cannot delete the last material category.');
  }

  const usage = getMaterialCategoryUsage(db, categoryId);
  if (usage.materialCount !== expectedMaterialCount) {
    throw new Error('Material count has changed. Please refresh and try again.');
  }

  if (usage.materialCount > 0 && !replacementCategoryId) {
    throw new Error('Cannot delete a category that contains materials without a replacement category.');
  }

  const deleteTx = db.transaction(() => {
    let reassignedCount = 0;
    
    if (usage.materialCount > 0 && replacementCategoryId) {
      const result = db.prepare('UPDATE materials SET category_id = ? WHERE category_id = ?').run(replacementCategoryId, categoryId);
      reassignedCount = result.changes;
    }

    db.prepare('DELETE FROM material_categories WHERE id = ?').run(categoryId);
    
    return {
      deletedCategoryId: categoryId,
      replacementCategoryId: replacementCategoryId,
      reassignedMaterialCount: reassignedCount
    };
  });

  return deleteTx();
}
