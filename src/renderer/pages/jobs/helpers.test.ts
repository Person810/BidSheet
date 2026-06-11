import { describe, expect, it } from 'vitest';
import { parseImportQuantity } from './helpers';

describe('parseImportQuantity', () => {
  it('parses plain and decimal numbers', () => {
    expect(parseImportQuantity('1250')).toBe(1250);
    expect(parseImportQuantity('12.5')).toBe(12.5);
  });

  it('strips thousands separators', () => {
    expect(parseImportQuantity('1,250')).toBe(1250);
    expect(parseImportQuantity('12,345.75')).toBe(12345.75);
  });

  it('ignores trailing units and surrounding text', () => {
    expect(parseImportQuantity('1,250 LF')).toBe(1250);
    expect(parseImportQuantity('approx. 40 EA')).toBe(40);
  });

  it('returns 0 for blanks, junk, and negatives', () => {
    expect(parseImportQuantity('')).toBe(0);
    expect(parseImportQuantity(null)).toBe(0);
    expect(parseImportQuantity('LS')).toBe(0);
    expect(parseImportQuantity('-50')).toBe(0);
  });
});
