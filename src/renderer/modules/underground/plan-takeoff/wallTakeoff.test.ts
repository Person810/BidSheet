import { describe, expect, it } from 'vitest';
import { computeWallQuantities } from './wallTakeoff';

const wall = (over: Partial<Parameters<typeof computeWallQuantities>[0]> = {}) =>
  computeWallQuantities({ lengthLF: 100, heightFt: 8, thicknessIn: 8, faces: 2, memberSpacingIn: 0, ...over });

describe('computeWallQuantities', () => {
  it('passes length through and computes one-face area', () => {
    const q = wall();
    expect(q.lengthLF).toBe(100);
    expect(q.faceSF).toBeCloseTo(800, 6); // 100 × 8
  });

  it('surface area scales with the number of faces', () => {
    expect(wall({ faces: 1 }).surfaceSF).toBe(800);
    expect(wall({ faces: 2 }).surfaceSF).toBe(1600);
  });

  it('volume is length × height × thickness in CY', () => {
    // 100 × 8 × (8/12) = 533.33 CF ÷ 27 = 19.75 CY
    expect(wall().volumeCY).toBeCloseTo(19.753, 2);
  });

  it('thicker walls have proportionally more volume', () => {
    expect(wall({ thicknessIn: 12 }).volumeCY).toBeCloseTo(wall({ thicknessIn: 6 }).volumeCY * 2, 5);
  });

  it('no members when spacing is zero', () => {
    const q = wall({ memberSpacingIn: 0 });
    expect(q.memberCount).toBe(0);
    expect(q.memberLF).toBe(0);
  });

  it('counts vertical members at spacing, each full height', () => {
    // 12 ft run at 16" o.c.: floor(12 / 1.333) + 1 = 9 + 1 = 10 members; × 8 ft = 80 LF
    const q = computeWallQuantities({ lengthLF: 12, heightFt: 8, thicknessIn: 6, faces: 2, memberSpacingIn: 16 });
    expect(q.memberCount).toBe(10);
    expect(q.memberLF).toBeCloseTo(80, 6);
  });

  it('tighter spacing yields more members', () => {
    expect(wall({ memberSpacingIn: 12 }).memberCount).toBeGreaterThan(wall({ memberSpacingIn: 24 }).memberCount);
  });
});
