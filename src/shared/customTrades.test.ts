import { describe, it, expect } from 'vitest';
import {
  MAX_CUSTOM_TRADES,
  MAX_CUSTOM_TRADE_NAME,
  addCustomTrades,
  cleanCustomTradeName,
  parseCustomTrades,
  removeCustomTrade,
  serializeCustomTrades,
} from './customTrades';

describe('cleanCustomTradeName', () => {
  it('trims and flattens the whitespace people actually type', () => {
    expect(cleanCustomTradeName('  Directional   Drilling \n')).toBe('Directional Drilling');
  });

  it('caps the length without leaving a trailing space behind', () => {
    const long = `${'a'.repeat(MAX_CUSTOM_TRADE_NAME - 1)} bcdef`;
    const cleaned = cleanCustomTradeName(long);
    expect(cleaned).toBe('a'.repeat(MAX_CUSTOM_TRADE_NAME - 1));
    expect(cleaned.length).toBeLessThanOrEqual(MAX_CUSTOM_TRADE_NAME);
  });

  it('gives back nothing for whitespace-only input', () => {
    expect(cleanCustomTradeName('   ')).toBe('');
  });
});

describe('parseCustomTrades', () => {
  it('reads a stored list', () => {
    expect(parseCustomTrades('Boring,Demolition')).toEqual(['Boring', 'Demolition']);
  });

  it('treats null and empty as no trades', () => {
    expect(parseCustomTrades(null)).toEqual([]);
    expect(parseCustomTrades(undefined)).toEqual([]);
    expect(parseCustomTrades('')).toEqual([]);
    expect(parseCustomTrades(' , ,')).toEqual([]);
  });

  it('drops case-insensitive duplicates, keeping the form first typed', () => {
    expect(parseCustomTrades('Boring,boring,BORING')).toEqual(['Boring']);
  });

  it('stops at the cap instead of growing without limit', () => {
    const many = Array.from({ length: MAX_CUSTOM_TRADES + 3 }, (_, i) => `Trade ${i}`);
    expect(parseCustomTrades(many.join(','))).toHaveLength(MAX_CUSTOM_TRADES);
  });
});

describe('addCustomTrades', () => {
  it('appends what was typed', () => {
    expect(addCustomTrades(['Boring'], 'Demolition')).toEqual(['Boring', 'Demolition']);
  });

  it('splits a pasted comma list into separate trades', () => {
    // The separator can't survive storage, so one name with a comma in it is
    // not an option — two trades is the reading that keeps both words.
    expect(addCustomTrades([], 'Boring, Demolition')).toEqual(['Boring', 'Demolition']);
  });

  it('ignores a blank entry and a name already in the list', () => {
    expect(addCustomTrades(['Boring'], '  ')).toEqual(['Boring']);
    expect(addCustomTrades(['Boring'], 'boring')).toEqual(['Boring']);
  });
});

describe('removeCustomTrade', () => {
  it('removes by name, matching however it was cased', () => {
    expect(removeCustomTrade(['Boring', 'Demolition'], 'boring')).toEqual(['Demolition']);
  });

  it('leaves the list alone when the name is not in it', () => {
    expect(removeCustomTrade(['Boring'], 'Paving')).toEqual(['Boring']);
  });
});

describe('serializeCustomTrades', () => {
  it('stores null when there is nothing to store', () => {
    expect(serializeCustomTrades([])).toBeNull();
    expect(serializeCustomTrades(['  '])).toBeNull();
  });

  it('round-trips through the stored form', () => {
    const list = ['Directional Drilling', 'Demolition'];
    expect(parseCustomTrades(serializeCustomTrades(list))).toEqual(list);
  });
});
