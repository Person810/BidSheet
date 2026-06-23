import { describe, expect, it } from 'vitest';
import { TRADE_SEED_DATA, TradeType } from './seed-data';

const TRADES = Object.keys(TRADE_SEED_DATA) as TradeType[];

describe('seed assemblies', () => {
  it('every assembly item references a material in the same trade', () => {
    const problems: string[] = [];
    for (const trade of TRADES) {
      const data = TRADE_SEED_DATA[trade];
      const matKeys = new Set(data.materials.map((m) => `${m.category}/${m.name}`));
      for (const asm of data.assemblies ?? []) {
        for (const item of asm.items) {
          const key = `${item.category}/${item.name}`;
          if (!matKeys.has(key)) {
            problems.push(`${trade} › "${asm.name}" → missing material "${key}"`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('assembly names are unique within a trade', () => {
    for (const trade of TRADES) {
      const names = (TRADE_SEED_DATA[trade].assemblies ?? []).map((a) => a.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('assemblies have a unit and at least one item', () => {
    for (const trade of TRADES) {
      for (const asm of TRADE_SEED_DATA[trade].assemblies ?? []) {
        expect(asm.unit, `${trade} › ${asm.name}`).toBeTruthy();
        expect(asm.items.length, `${trade} › ${asm.name}`).toBeGreaterThan(0);
      }
    }
  });

  it('all item quantities are positive', () => {
    for (const trade of TRADES) {
      for (const asm of TRADE_SEED_DATA[trade].assemblies ?? []) {
        for (const item of asm.items) {
          expect(item.quantity, `${trade} › ${asm.name} › ${item.name}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('concrete ships starter assemblies', () => {
    // The concrete trade is the headline expansion — guard against the seed
    // being accidentally dropped.
    expect((TRADE_SEED_DATA.concrete.assemblies ?? []).length).toBeGreaterThan(0);
  });
});
