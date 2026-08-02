import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EQUIPMENT_CATEGORIES,
  MAX_EQUIPMENT_CATEGORIES,
  MAX_EQUIPMENT_CATEGORY_NAME,
  cleanEquipmentCategoryName,
  equipmentCategoryKey,
  parseEquipmentCategories,
  storedEquipmentCategories,
  serializeEquipmentCategories,
  resolveEquipmentCategories,
  sortEquipmentCategories,
  validateEquipmentCategoryName,
} from './equipmentCategories';

describe('cleanEquipmentCategoryName', () => {
  it('trims and flattens whitespace', () => {
    expect(cleanEquipmentCategoryName('  Skid   Steer  ')).toBe('Skid Steer');
  });

  it('strips commas, which are the storage separator', () => {
    expect(cleanEquipmentCategoryName('Pumps, Compressors')).toBe('Pumps Compressors');
  });

  it('applies NFKC normalization', () => {
    expect(cleanEquipmentCategoryName('Café')).toBe('Café');
  });

  it('caps the length', () => {
    const long = 'A'.repeat(MAX_EQUIPMENT_CATEGORY_NAME + 20);
    expect(cleanEquipmentCategoryName(long)).toHaveLength(MAX_EQUIPMENT_CATEGORY_NAME);
  });

  it('returns empty for a non-name', () => {
    expect(cleanEquipmentCategoryName('   ')).toBe('');
  });
});

describe('parseEquipmentCategories', () => {
  it('reads null back as null so "never edited" survives the round trip', () => {
    expect(parseEquipmentCategories(null)).toBeNull();
    expect(parseEquipmentCategories(undefined)).toBeNull();
  });

  it('reads an empty string as a deliberately empty list', () => {
    expect(parseEquipmentCategories('')).toEqual([]);
  });

  it('splits on commas and drops blanks', () => {
    expect(parseEquipmentCategories('Excavator,,Truck, ')).toEqual(['Excavator', 'Truck']);
  });

  it('drops case-insensitive duplicates, keeping the first spelling', () => {
    expect(parseEquipmentCategories('Excavator,EXCAVATOR,excavator')).toEqual(['Excavator']);
  });

  it('caps the number of categories', () => {
    const many = Array.from({ length: MAX_EQUIPMENT_CATEGORIES + 10 }, (_, i) => `Cat ${i}`);
    expect(parseEquipmentCategories(many.join(','))).toHaveLength(MAX_EQUIPMENT_CATEGORIES);
  });
});

describe('storedEquipmentCategories', () => {
  it('falls back to the defaults when never edited', () => {
    expect(storedEquipmentCategories(null)).toEqual([...DEFAULT_EQUIPMENT_CATEGORIES]);
  });

  it('does NOT fall back once the list is explicitly empty', () => {
    expect(storedEquipmentCategories('')).toEqual([]);
  });
});

describe('serializeEquipmentCategories', () => {
  it('round-trips a list', () => {
    const list = ['Excavator', 'Truck'];
    expect(parseEquipmentCategories(serializeEquipmentCategories(list))).toEqual(list);
  });

  it('stores an empty list as "" so the defaults do not come back', () => {
    expect(serializeEquipmentCategories([])).toBe('');
    expect(storedEquipmentCategories(serializeEquipmentCategories([]))).toEqual([]);
  });

  it('cleans names on the way in', () => {
    expect(serializeEquipmentCategories([' Skid  Steer ', 'Truck,Trailer'])).toBe(
      'Skid Steer,Truck Trailer'
    );
  });
});

describe('resolveEquipmentCategories', () => {
  it('unions the stored list with categories already in use', () => {
    expect(resolveEquipmentCategories('Truck', ['Excavator'])).toEqual(['Excavator', 'Truck']);
  });

  it('keeps an in-use category the list has never heard of', () => {
    // A row synced from a machine with a different list must not vanish
    // from the picker just because this machine's list omits it.
    expect(resolveEquipmentCategories('', ['Vac Truck'])).toEqual(['Vac Truck']);
  });

  it('does not duplicate a category that is both listed and in use', () => {
    expect(resolveEquipmentCategories('Truck', ['truck'])).toEqual(['Truck']);
  });

  it('offers the defaults when the list has never been edited', () => {
    expect(resolveEquipmentCategories(null)).toEqual(
      sortEquipmentCategories([...DEFAULT_EQUIPMENT_CATEGORIES])
    );
  });

  it('sorts case-insensitively', () => {
    expect(resolveEquipmentCategories('zebra,Alpha,beta')).toEqual(['Alpha', 'beta', 'zebra']);
  });
});

describe('validateEquipmentCategoryName', () => {
  it('rejects a blank name', () => {
    expect(validateEquipmentCategoryName('  ', [])).toBe('Category name is required.');
  });

  it('rejects commas explicitly rather than silently rewriting them', () => {
    expect(validateEquipmentCategoryName('Pumps, Compressors', [])).toBe(
      'Category names cannot contain commas.'
    );
  });

  it('rejects a case-insensitive duplicate', () => {
    expect(validateEquipmentCategoryName('excavator', ['Excavator'])).toBe(
      'A category with this name already exists.'
    );
  });

  it('allows a rename that collides only with itself', () => {
    expect(validateEquipmentCategoryName('EXCAVATOR', ['Excavator'], 'Excavator')).toBeNull();
  });

  it('rejects adding past the cap but still allows renaming at the cap', () => {
    const full = Array.from({ length: MAX_EQUIPMENT_CATEGORIES }, (_, i) => `Cat ${i}`);
    expect(validateEquipmentCategoryName('One More', full)).toContain('at most');
    expect(validateEquipmentCategoryName('Cat 0 Renamed', full, 'Cat 0')).toBeNull();
  });
});

describe('equipmentCategoryKey', () => {
  it('matches names that differ only by case and spacing', () => {
    expect(equipmentCategoryKey('  Skid   Steer ')).toBe(equipmentCategoryKey('skid steer'));
  });
});
