import { describe, expect, it } from 'vitest';
import { computeWallQuantities } from './wallTakeoff';

describe('computeWallQuantities', () => {
  it('converts length × height × thickness to concrete CY', () => {
    // 100 LF × 8 ft × (8/12) ft = 533.33 CF ÷ 27 = 19.75 CY
    const q = computeWallQuantities({ lengthLF: 100, heightFt: 8, thicknessIn: 8, faces: 2, rebarSpacingIn: 0 });
    expect(q.faceSF).toBeCloseTo(800, 6);
    expect(q.concreteCY).toBeCloseTo(19.753, 2);
  });

  it('form contact area scales with faces formed', () => {
    const one = computeWallQuantities({ lengthLF: 50, heightFt: 10, thicknessIn: 8, faces: 1, rebarSpacingIn: 0 });
    const two = computeWallQuantities({ lengthLF: 50, heightFt: 10, thicknessIn: 8, faces: 2, rebarSpacingIn: 0 });
    expect(one.formSFCA).toBe(500);   // 50 × 10 × 1
    expect(two.formSFCA).toBe(1000);  // 50 × 10 × 2
  });

  it('omits rebar when spacing is zero, includes it otherwise', () => {
    const none = computeWallQuantities({ lengthLF: 40, heightFt: 8, thicknessIn: 8, faces: 2, rebarSpacingIn: 0 });
    const grid = computeWallQuantities({ lengthLF: 40, heightFt: 8, thicknessIn: 8, faces: 2, rebarSpacingIn: 12 });
    expect(none.rebarLF).toBe(0);
    expect(grid.rebarLF).toBeGreaterThan(0);
  });

  it('tighter rebar spacing yields more steel', () => {
    const tight = computeWallQuantities({ lengthLF: 40, heightFt: 8, thicknessIn: 8, faces: 2, rebarSpacingIn: 6 });
    const loose = computeWallQuantities({ lengthLF: 40, heightFt: 8, thicknessIn: 8, faces: 2, rebarSpacingIn: 18 });
    expect(tight.rebarLF).toBeGreaterThan(loose.rebarLF);
  });

  it('passes length through unchanged', () => {
    const q = computeWallQuantities({ lengthLF: 123.4, heightFt: 8, thicknessIn: 8, faces: 2, rebarSpacingIn: 0 });
    expect(q.lengthLF).toBe(123.4);
  });

  it('thicker walls pour more concrete', () => {
    const thin = computeWallQuantities({ lengthLF: 100, heightFt: 8, thicknessIn: 6, faces: 2, rebarSpacingIn: 0 });
    const thick = computeWallQuantities({ lengthLF: 100, heightFt: 8, thicknessIn: 12, faces: 2, rebarSpacingIn: 0 });
    expect(thick.concreteCY).toBeCloseTo(thin.concreteCY * 2, 5);
  });
});
