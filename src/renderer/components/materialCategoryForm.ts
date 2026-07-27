import type { MaterialCategoryManagementRow } from '../../shared/types/ipc';

export interface CategoryForm {
  name: string;
  description: string;
}

/** Create an empty form for adding a new category. */
export function createEmptyCategoryForm(): CategoryForm {
  return { name: '', description: '' };
}

/** Create a pre-filled form for editing an existing category. */
export function createCategoryEditForm(category: { name: string; description: string | null }): CategoryForm {
  return { name: category.name, description: category.description || '' };
}

/** Validate category form fields. Returns error message or null. */
export function validateCategoryForm(form: CategoryForm): string | null {
  const trimmed = form.name.trim();
  if (!trimmed) return 'Category name is required.';
  if (trimmed.length > 100) return 'Category name must be 100 characters or fewer.';
  return null;
}

/** Sort categories alphabetically, case-insensitive. */
export function sortMaterialCategories<T extends { name: string }>(categories: T[]): T[] {
  return [...categories].sort((a, b) =>
    a.name.localeCompare(b.name, 'en-US', { sensitivity: 'base' })
  );
}

/** Determine sidebar selection after deleting a category. */
export function getPostDeleteCategorySelection(
  deletedId: number,
  replacementId: number | null,
  currentSelection: number | null
): number | null {
  if (currentSelection !== deletedId) return currentSelection;
  return replacementId;
}

/** Get available replacement categories (excludes the source). */
export function getReplacementCategories(
  categories: { id: number; name: string }[],
  sourceId: number
): { id: number; name: string }[] {
  return categories.filter(c => c.id !== sourceId);
}

/** Check if an error is the stale-count concurrency error. */
export function isStaleCategoryUsageError(errorMessage: string): boolean {
  return errorMessage.toLowerCase().includes('material count has changed');
}
