import { describe, expect, it } from 'vitest';
import {
  calculateConcrete,
  rebarGridLF,
  validateInput,
  explainConcrete,
  DEFAULT_WASTE_PCT,
  type ConcreteInput,
} from './concreteCalc';

const input = (overrides: Partial<ConcreteInput> = {}): ConcreteInput => ({
  element: 'slab',
  areaSF: 1000,
  thicknessIn: 4,
  perimeterLF: 130,
  formHeightIn: 0,
  formBothFaces: false,
  wastePct: 0,
  rebarSpacingIn: 0,
  includeMesh: false,
  subbaseIn: 0,
  ...overrides,
});

describe('validateInput', () => {
  it('accepts a typical slab', () => {
    expect(validateInput(input())).toEqual([]);
  });

  it('flags each out-of-range field', () => {
    const errors = validateInput(input({
      areaSF: 0,
      thicknessIn: 0,
      perimeterLF: -1,
      wastePct: 150,
      subbaseIn: -2,
    }));
    const fields = errors.map((e) => e.field).sort();
    expect(fields).toEqual(['areaSF', 'perimeterLF', 'subbaseIn', 'thicknessIn', 'wastePct']);
  });
});

describe('calculateConcrete — volume', () => {
  it('converts area × thickness to cubic yards', () => {
    // 1000 SF × (4/12) ft = 333.33 CF ÷ 27 = 12.35 CY
    const out = calculateConcrete(input());
    expect(out.neatCY).toBeCloseTo(12.346, 2);
  });

  it('applies the waste allowance to the order volume', () => {
    const out = calculateConcrete(input({ wastePct: 8 }));
    expect(out.orderCY).toBeCloseTo(12.346 * 1.08, 2);
  });

  it('order equals neat when waste is zero', () => {
    const out = calculateConcrete(input({ wastePct: 0 }));
    expect(out.orderCY).toBeCloseTo(out.neatCY, 6);
  });
});

describe('calculateConcrete — formwork', () => {
  it('slab edge forms run the perimeter at the slab thickness', () => {
    // 130 LF × (4/12) ft = 43.33 SFCA
    const out = calculateConcrete(input());
    expect(out.formSFCA).toBeCloseTo(43.333, 2);
  });

  it('honors an explicit form height over the slab thickness', () => {
    const out = calculateConcrete(input({ formHeightIn: 6 }));
    expect(out.formSFCA).toBeCloseTo(130 * 0.5, 2);
  });

  it('walls form one or both faces over the plan area', () => {
    const oneFace = calculateConcrete(input({ element: 'wall', areaSF: 800 }));
    expect(oneFace.formSFCA).toBe(800);
    const bothFaces = calculateConcrete(input({ element: 'wall', areaSF: 800, formBothFaces: true }));
    expect(bothFaces.formSFCA).toBe(1600);
  });

  it('only slabs report a finished surface', () => {
    expect(calculateConcrete(input({ element: 'slab' })).finishSF).toBe(1000);
    expect(calculateConcrete(input({ element: 'wall' })).finishSF).toBe(0);
    expect(calculateConcrete(input({ element: 'footing' })).finishSF).toBe(0);
  });
});

describe('rebarGridLF', () => {
  it('is zero without spacing or area', () => {
    expect(rebarGridLF(0, 12)).toBe(0);
    expect(rebarGridLF(1000, 0)).toBe(0);
  });

  it('computes a both-ways grid on a square slab', () => {
    // 100 SF → 10 ft side; 12" o.c. → floor(10/1)+1 = 11 bars/dir
    // 11 bars × 10 ft × 2 dirs = 220 LF
    expect(rebarGridLF(100, 12)).toBeCloseTo(220, 6);
  });

  it('tighter spacing yields more steel', () => {
    expect(rebarGridLF(400, 6)).toBeGreaterThan(rebarGridLF(400, 18));
  });
});

describe('calculateConcrete — mesh & subbase', () => {
  it('mesh area matches slab area only when included', () => {
    expect(calculateConcrete(input({ includeMesh: true })).meshSF).toBe(1000);
    expect(calculateConcrete(input({ includeMesh: false })).meshSF).toBe(0);
  });

  it('subbase volume uses its own depth', () => {
    // 1000 SF × (6/12) ft = 500 CF ÷ 27 = 18.52 CY
    const out = calculateConcrete(input({ subbaseIn: 6 }));
    expect(out.subbaseCY).toBeCloseTo(18.519, 2);
  });

  it('no subbase volume when depth is zero', () => {
    expect(calculateConcrete(input({ subbaseIn: 0 })).subbaseCY).toBe(0);
  });
});

describe('explainConcrete', () => {
  it('produces an order breakdown ending in the order volume', () => {
    const inp = input({ wastePct: 8 });
    const out = calculateConcrete(inp);
    const { order } = explainConcrete(inp, out);
    const result = order.lines.find((l) => l.kind === 'result');
    expect(result?.value).toContain('CY');
  });

  it('omits rebar/subbase breakdowns when not used', () => {
    const inp = input();
    const math = explainConcrete(inp, calculateConcrete(inp));
    expect(math.rebar).toBeNull();
    expect(math.subbase).toBeNull();
  });

  it('includes rebar/subbase breakdowns when used', () => {
    const inp = input({ rebarSpacingIn: 12, subbaseIn: 4 });
    const math = explainConcrete(inp, calculateConcrete(inp));
    expect(math.rebar).not.toBeNull();
    expect(math.subbase).not.toBeNull();
  });
});

describe('DEFAULT_WASTE_PCT', () => {
  it('is a sane single-digit allowance', () => {
    expect(DEFAULT_WASTE_PCT).toBeGreaterThan(0);
    expect(DEFAULT_WASTE_PCT).toBeLessThanOrEqual(15);
  });
});
