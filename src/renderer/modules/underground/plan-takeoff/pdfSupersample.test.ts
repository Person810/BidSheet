import { describe, expect, it } from 'vitest';
import { supersampleFactor } from './PdfViewer';

// A large civil sheet (ARCH-D, 36x24in at 72pt/in) — the case where
// zoomed-out rendering falls apart.
const SHEET_W = 2592;
const SHEET_H = 1728;

describe('supersampleFactor', () => {
  it('oversamples a zoomed-out sheet on a 1x display', () => {
    // Fit-to-width in a ~1200px pane is roughly 0.46 scale
    const ss = supersampleFactor(0.46, 1, SHEET_W, SHEET_H);
    expect(ss).toBeGreaterThan(1.5);
    expect(ss).toBeLessThanOrEqual(2.5);
  });

  it('is a no-op once the native density is already sufficient', () => {
    // scale 2 on a 1x display, or scale 1 on a 2x display, both hit density 2
    expect(supersampleFactor(2, 1, SHEET_W, SHEET_H)).toBe(1);
    expect(supersampleFactor(1, 2, SHEET_W, SHEET_H)).toBe(1);
    expect(supersampleFactor(3, 2, SHEET_W, SHEET_H)).toBe(1);
  });

  it('accounts for dpr, so a retina display oversamples less', () => {
    const at1x = supersampleFactor(0.5, 1, SHEET_W, SHEET_H);
    const at2x = supersampleFactor(0.5, 2, SHEET_W, SHEET_H);
    expect(at2x).toBeLessThan(at1x);
  });

  it('never exceeds the ceiling even at minimum zoom', () => {
    expect(supersampleFactor(0.25, 1, SHEET_W, SHEET_H)).toBeLessThanOrEqual(2.5);
    expect(supersampleFactor(0.01, 1, SHEET_W, SHEET_H)).toBeLessThanOrEqual(2.5);
  });

  it('keeps the resulting bitmap inside the pixel budget', () => {
    const budget = 24_000_000;
    for (const scale of [0.25, 0.5, 0.75, 1, 1.5, 2, 5]) {
      for (const dpr of [1, 1.5, 2, 3]) {
        const ss = supersampleFactor(scale, dpr, SHEET_W, SHEET_H, budget);
        const px = (SHEET_W * scale * ss * dpr) * (SHEET_H * scale * ss * dpr);
        // A factor of 1 is the floor — the budget can't force us below native
        if (ss > 1) expect(px).toBeLessThanOrEqual(budget * 1.0001);
        expect(ss).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('falls back to 1 for degenerate inputs', () => {
    expect(supersampleFactor(0, 1, SHEET_W, SHEET_H)).toBe(1);
    expect(supersampleFactor(0.5, 0, SHEET_W, SHEET_H)).toBe(1);
    expect(supersampleFactor(0.5, 1, 0, SHEET_H)).toBe(1);
    expect(supersampleFactor(0.5, 1, SHEET_W, 0)).toBe(1);
  });
});
