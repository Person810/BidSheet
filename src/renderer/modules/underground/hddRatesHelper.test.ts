import { describe, it, expect } from 'vitest';
import { lookupTableValue, updateTableValues } from './hddRatesHelper';

describe('hddRatesHelper', () => {
  describe('lookupTableValue', () => {
    const testTable: Array<[number, number]> = [
      [90, 7000],
      [160, 9000],
      [250, 12000]
    ];

    it('returns default value for empty table', () => {
      expect(lookupTableValue([], 90, 500)).toBe(500);
    });

    it('finds exact matches', () => {
      expect(lookupTableValue(testTable, 90)).toBe(7000);
      expect(lookupTableValue(testTable, 160)).toBe(9000);
      expect(lookupTableValue(testTable, 250)).toBe(12000);
    });

    it('uses upper bound fallback logic for size in between brackets', () => {
      expect(lookupTableValue(testTable, 63)).toBe(7000);
      expect(lookupTableValue(testTable, 110)).toBe(9000);
      expect(lookupTableValue(testTable, 200)).toBe(12000);
    });

    it('uses last value for size exceeding the maximum bracket', () => {
      expect(lookupTableValue(testTable, 300)).toBe(12000);
    });
  });

  describe('updateTableValues', () => {
    const testTable: Array<[number, number]> = [
      [90, 7000],
      [160, 9000]
    ];
    const sizes = [63, 90, 110, 160];

    it('reconstructs table with all standard sizes and updates target value', () => {
      const result = updateTableValues(testTable, sizes, 90, 7500);
      
      expect(result).toHaveLength(4);
      expect(result[0]).toEqual([63, 7000]); // lookup fallback of 90 is 7000
      expect(result[1]).toEqual([90, 7500]); // updated value
      expect(result[2]).toEqual([110, 9000]); // lookup fallback of 160 is 9000
      expect(result[3]).toEqual([160, 9000]); // kept original
    });
  });
});
