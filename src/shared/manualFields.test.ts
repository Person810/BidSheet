import { describe, it, expect } from 'vitest';
import {
  parseManualFields, serializeManualFields, isManual, withManual, OVERRIDABLE_FIELDS,
} from './manualFields';

describe('parseManualFields', () => {
  it('parses a valid JSON array, dropping unknown keys', () => {
    expect(parseManualFields('["laborHours","bogus","materialUnitCost"]'))
      .toEqual(['laborHours', 'materialUnitCost']);
  });

  it('returns [] for null, empty, or malformed input', () => {
    expect(parseManualFields(null)).toEqual([]);
    expect(parseManualFields('')).toEqual([]);
    expect(parseManualFields('not json')).toEqual([]);
    expect(parseManualFields('{"a":1}')).toEqual([]);
  });

  it('de-dupes', () => {
    expect(parseManualFields('["laborHours","laborHours"]')).toEqual(['laborHours']);
  });
});

describe('serializeManualFields', () => {
  it('round-trips through parse', () => {
    const fields = ['materialUnitCost', 'equipmentCostPerHour'];
    expect(parseManualFields(serializeManualFields(fields))).toEqual(fields);
  });

  it('is null when empty (keeps the column tidy)', () => {
    expect(serializeManualFields([])).toBeNull();
    expect(serializeManualFields(['unknown'])).toBeNull();
  });
});

describe('withManual / isManual', () => {
  it('adds and removes a field immutably', () => {
    const a = withManual([], 'laborHours', true);
    expect(isManual(a, 'laborHours')).toBe(true);
    const b = withManual(a, 'laborHours', false);
    expect(isManual(b, 'laborHours')).toBe(false);
    expect(a).not.toBe(b); // new arrays
  });

  it('toggling on twice does not duplicate', () => {
    expect(withManual(['laborHours'], 'laborHours', true)).toEqual(['laborHours']);
  });

  it('covers exactly the four overridable fields', () => {
    expect([...OVERRIDABLE_FIELDS].sort()).toEqual(
      ['equipmentCostPerHour', 'laborCostPerHour', 'laborHours', 'materialUnitCost'],
    );
  });
});
