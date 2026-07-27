import { describe, it, expect } from 'vitest';
import {
  validateCategoryForm,
  sortMaterialCategories,
  getPostDeleteCategorySelection,
  getReplacementCategories,
  isStaleCategoryUsageError,
  createEmptyCategoryForm,
  createCategoryEditForm,
} from './materialCategoryForm';

describe('validateCategoryForm', () => {
  it('returns error for blank name', () => {
    expect(validateCategoryForm({ name: '', description: '' })).toBe('Category name is required.');
    expect(validateCategoryForm({ name: '   ', description: '' })).toBe('Category name is required.');
  });

  it('returns error for name over 100 chars', () => {
    expect(validateCategoryForm({ name: 'A'.repeat(101), description: '' })).toBe('Category name must be 100 characters or fewer.');
  });

  it('returns null for valid name', () => {
    expect(validateCategoryForm({ name: 'Valid Name', description: '' })).toBeNull();
  });
});

describe('sortMaterialCategories', () => {
  it('sorts case-insensitively', () => {
    const cats = [
      { id: 1, name: 'Valves', description: null, materialCount: 0 },
      { id: 2, name: 'fittings', description: null, materialCount: 0 },
      { id: 3, name: 'Pipe', description: null, materialCount: 0 },
    ];
    const sorted = sortMaterialCategories(cats);
    expect(sorted.map(c => c.name)).toEqual(['fittings', 'Pipe', 'Valves']);
  });
});

describe('getPostDeleteCategorySelection', () => {
  it('returns replacement when populated delete', () => {
    expect(getPostDeleteCategorySelection(1, 2, 1)).toBe(2);
  });

  it('returns null (All Materials) when empty delete of selected', () => {
    expect(getPostDeleteCategorySelection(1, null, 1)).toBeNull();
  });

  it('keeps current selection when deleting non-selected', () => {
    expect(getPostDeleteCategorySelection(1, 2, 3)).toBe(3);
  });
});

describe('getReplacementCategories', () => {
  it('excludes source category', () => {
    const cats = [
      { id: 1, name: 'A', description: null, materialCount: 0 },
      { id: 2, name: 'B', description: null, materialCount: 0 },
    ];
    const result = getReplacementCategories(cats, 1);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });
});

describe('isStaleCategoryUsageError', () => {
  it('detects stale count error messages', () => {
    expect(isStaleCategoryUsageError('Material count has changed')).toBe(true);
    expect(isStaleCategoryUsageError('Material count has changed. Please refresh and try again.')).toBe(true);
  });

  it('returns false for other errors', () => {
    expect(isStaleCategoryUsageError('Some other error')).toBe(false);
  });
});

describe('createEmptyCategoryForm', () => {
  it('returns empty form', () => {
    const form = createEmptyCategoryForm();
    expect(form.name).toBe('');
    expect(form.description).toBe('');
  });
});

describe('createCategoryEditForm', () => {
  it('populates from category', () => {
    const form = createCategoryEditForm({ name: 'Test', description: 'Desc' });
    expect(form.name).toBe('Test');
    expect(form.description).toBe('Desc');
  });
});
