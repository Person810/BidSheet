import { describe, expect, it } from 'vitest';
import {
  calloutEdgePoint,
  cappedLabelSize,
  LABEL_MAX_PX,
  computePolygonAreaSF,
  computePolygonPerimeterLF,
  computeRunLengthLF,
  normalizeRect,
  orthoConstrainPoint,
  polygonCentroid,
  rectContains,
} from './takeoffUtils';

describe('computeRunLengthLF', () => {
  it('sums segment lengths and converts px to feet', () => {
    // 3-4-5 triangle: 300px + 400px legs, scale 10 px/ft
    const pts = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 400 }];
    expect(computeRunLengthLF(pts, 10)).toBeCloseTo(70);
  });

  it('returns 0 without a calibrated scale', () => {
    expect(computeRunLengthLF([{ x: 0, y: 0 }, { x: 100, y: 0 }], 0)).toBe(0);
  });
});

describe('polygon math', () => {
  // 100x50 px rectangle at scale 10 px/ft = 10ft x 5ft
  const rect = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];

  it('computes area via shoelace in square feet', () => {
    expect(computePolygonAreaSF(rect, 10)).toBeCloseTo(50);
  });

  it('area is orientation-independent', () => {
    expect(computePolygonAreaSF([...rect].reverse(), 10)).toBeCloseTo(50);
  });

  it('computes closed perimeter in linear feet', () => {
    expect(computePolygonPerimeterLF(rect, 10)).toBeCloseTo(30);
  });

  it('finds the centroid of a rectangle', () => {
    const c = polygonCentroid(rect);
    expect(c.x).toBeCloseTo(50);
    expect(c.y).toBeCloseTo(25);
  });

  it('falls back to vertex average for degenerate (zero-area) polygons', () => {
    const c = polygonCentroid([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }]);
    expect(c.x).toBeCloseTo(10);
    expect(c.y).toBeCloseTo(0);
  });
});

describe('orthoConstrainPoint', () => {
  const anchor = { x: 100, y: 100 };

  it('snaps to horizontal when the move is mostly horizontal', () => {
    expect(orthoConstrainPoint({ x: 180, y: 110 }, anchor)).toEqual({ x: 180, y: 100 });
  });

  it('snaps to vertical when the move is mostly vertical', () => {
    expect(orthoConstrainPoint({ x: 110, y: 180 }, anchor)).toEqual({ x: 100, y: 180 });
  });

  it('passes through without an anchor', () => {
    expect(orthoConstrainPoint({ x: 5, y: 7 }, null)).toEqual({ x: 5, y: 7 });
    expect(orthoConstrainPoint({ x: 5, y: 7 }, undefined)).toEqual({ x: 5, y: 7 });
  });
});

describe('marquee rect helpers', () => {
  it('normalizes corners dragged in any direction', () => {
    expect(normalizeRect({ x: 50, y: 60 }, { x: 10, y: 20 }))
      .toEqual({ x: 10, y: 20, w: 40, h: 40 });
  });

  it('tests point containment inclusively', () => {
    const r = { x: 0, y: 0, w: 10, h: 10 };
    expect(rectContains(r, { x: 5, y: 5 })).toBe(true);
    expect(rectContains(r, { x: 10, y: 10 })).toBe(true);
    expect(rectContains(r, { x: 11, y: 5 })).toBe(false);
  });
});

describe('calloutEdgePoint', () => {
  const center = { x: 100, y: 100 };
  const halfW = 20;
  const halfH = 10;

  it('exits the vertical border for a mostly-horizontal leader', () => {
    expect(calloutEdgePoint(center, { x: 300, y: 100 }, halfW, halfH))
      .toEqual({ x: 120, y: 100 });
    expect(calloutEdgePoint(center, { x: -300, y: 100 }, halfW, halfH))
      .toEqual({ x: 80, y: 100 });
  });

  it('exits the horizontal border for a mostly-vertical leader', () => {
    expect(calloutEdgePoint(center, { x: 100, y: 400 }, halfW, halfH))
      .toEqual({ x: 100, y: 110 });
    expect(calloutEdgePoint(center, { x: 100, y: -400 }, halfW, halfH))
      .toEqual({ x: 100, y: 90 });
  });

  it('stays on the true leader angle rather than snapping to an edge midpoint', () => {
    // Diagonal: y hits its half-extent first, and x rides along proportionally
    const p = calloutEdgePoint(center, { x: 200, y: 200 }, halfW, halfH);
    expect(p).toEqual({ x: 110, y: 110 });
    // The exit point is colinear with center -> anchor
    expect((p.y - center.y) / (p.x - center.x)).toBeCloseTo(1, 10);
  });

  it('lands exactly on a corner when the leader runs through it', () => {
    expect(calloutEdgePoint(center, { x: 140, y: 120 }, halfW, halfH))
      .toEqual({ x: 120, y: 110 });
  });

  it('returns the center for a degenerate direction', () => {
    expect(calloutEdgePoint(center, center, halfW, halfH)).toEqual(center);
  });
});

describe('cappedLabelSize', () => {
  it('caps a large-sheet size to the on-screen ceiling', () => {
    // 30 page units at 1 px/unit renders as 30px — well over the cap
    expect(cappedLabelSize(30, 1)).toBe(LABEL_MAX_PX);
  });

  it('leaves a small-sheet size untouched', () => {
    expect(cappedLabelSize(8, 1)).toBe(8);
  });

  it('caps in on-screen px, not page units', () => {
    // At 0.5 px/unit a 30-unit label is only 15px, so the cap is 26 units
    expect(cappedLabelSize(30, 0.5)).toBe(LABEL_MAX_PX / 0.5);
    // At 4 px/unit even a 5-unit label is 20px and gets clamped
    expect(cappedLabelSize(5, 4)).toBe(LABEL_MAX_PX / 4);
  });

  it('falls back to the raw size for a non-positive scale', () => {
    expect(cappedLabelSize(30, 0)).toBe(30);
    expect(cappedLabelSize(30, -1)).toBe(30);
  });
});
