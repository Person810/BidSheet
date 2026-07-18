import { describe, expect, it } from 'vitest';
import { asPriceState, countStaleLines, priceAgeDays, STALE_PRICE_DAYS } from './priceState';

const NOW = new Date('2026-07-17T12:00:00');

describe('priceAgeDays', () => {
  it('parses SQLite localtime timestamps', () => {
    expect(priceAgeDays('2026-07-10 08:30:00', NOW)).toBe(7);
    expect(priceAgeDays('2026-07-17 08:00:00', NOW)).toBe(0);
  });

  it('handles date-only strings', () => {
    expect(priceAgeDays('2026-04-18', NOW)).toBe(90);
  });

  it('returns null for missing or unparseable input', () => {
    expect(priceAgeDays(null, NOW)).toBeNull();
    expect(priceAgeDays(undefined, NOW)).toBeNull();
    expect(priceAgeDays('not a date', NOW)).toBeNull();
  });
});

describe('countStaleLines', () => {
  const ages = new Map<number, number | null>([
    [1, 120],                    // stale
    [2, 10],                     // fresh
    [3, null],                   // unknown → never stale
    [4, STALE_PRICE_DAYS],       // exactly at threshold → stale
  ]);

  it('counts only material-backed lines at/over the threshold', () => {
    const lineItems = {
      10: [
        { material_id: 1 },      // stale
        { material_id: 2 },      // fresh
        { material_id: null },   // labor-only
      ],
      11: [
        { material_id: 3 },      // unknown age
        { material_id: 4 },      // stale (at threshold)
        { material_id: 1 },      // stale again (counts per line)
      ],
    };
    expect(countStaleLines(lineItems, ages)).toBe(3);
  });

  it('is zero for empty bids', () => {
    expect(countStaleLines({}, ages)).toBe(0);
  });

  it('ignores materials missing from the map', () => {
    expect(countStaleLines({ 1: [{ material_id: 999 }] }, ages)).toBe(0);
  });
});

describe('asPriceState', () => {
  it('defaults unknown values to seed', () => {
    expect(asPriceState('confirmed')).toBe('confirmed');
    expect(asPriceState('bogus')).toBe('seed');
    expect(asPriceState(null)).toBe('seed');
  });
});
