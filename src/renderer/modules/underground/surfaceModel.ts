/**
 * Surface modeling primitives for earthwork takeoff.
 *
 * Pure functions -- no React, no side effects. Mirrors the trenchCalc.ts
 * convention so it can be reused by the plan-takeoff overlay and any
 * standalone earthwork tool.
 *
 * All geometry here is in FEET. Convert PDF-native pixels to feet with the
 * page's scale (px / scale_px_per_ft) BEFORE calling into this module, the
 * same way sendAreasToBid does for areas.
 *
 * Requires `delaunator` (ISC license, GPL-3 compatible):
 *   npm i delaunator
 *   npm i -D @types/delaunator   # v5 also ships its own types
 */

import Delaunator from 'delaunator';

export interface Pt2 { x: number; y: number; }
export interface Pt3 extends Pt2 { z: number; }

export interface Tin {
  points: Pt3[];
  /** Flat vertex-index triples into `points` (length is a multiple of 3). */
  triangles: Uint32Array;
}

// ---- TIN construction ------------------------------------------------------

/**
 * Build a Delaunay triangulation over the XY plane. The Z values ride along
 * on each point and are used only for interpolation. Needs >= 3 points that
 * aren't all colinear; otherwise returns an empty triangle list.
 */
export function buildTin(points: Pt3[]): Tin {
  if (points.length < 3) {
    return { points: points.slice(), triangles: new Uint32Array(0) };
  }
  const d = Delaunator.from(points, (p) => p.x, (p) => p.y);
  return { points: points.slice(), triangles: d.triangles };
}

// ---- Interpolation ---------------------------------------------------------

/**
 * Interpolate the surface elevation at (x, y) by locating the containing
 * triangle and blending its three corner Z values with barycentric weights.
 * Returns null when (x, y) falls outside the TIN's convex hull (no data).
 *
 * NOTE: this is a linear scan over triangles -- fine for takeoff-sized point
 * sets (hundreds of points). If you ever feed it dense survey/LiDAR data,
 * add a triangle bbox index or a halfedge walk to avoid O(cells x triangles).
 */
export function interpolateZ(tin: Tin, x: number, y: number): number | null {
  const { points, triangles } = tin;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = points[triangles[t]];
    const b = points[triangles[t + 1]];
    const c = points[triangles[t + 2]];
    const w = barycentric(x, y, a, b, c);
    if (w) return w.wa * a.z + w.wb * b.z + w.wc * c.z;
  }
  return null;
}

function barycentric(
  px: number, py: number, a: Pt2, b: Pt2, c: Pt2,
): { wa: number; wb: number; wc: number } | null {
  const v0x = b.x - a.x, v0y = b.y - a.y;
  const v1x = c.x - a.x, v1y = c.y - a.y;
  const v2x = px - a.x, v2y = py - a.y;
  const den = v0x * v1y - v1x * v0y;
  if (Math.abs(den) < 1e-12) return null; // degenerate / zero-area triangle
  const wb = (v2x * v1y - v1x * v2y) / den;
  const wc = (v0x * v2y - v2x * v0y) / den;
  const wa = 1 - wb - wc;
  const eps = -1e-9; // tolerance so shared edges don't fall through cracks
  if (wa < eps || wb < eps || wc < eps) return null; // outside this triangle
  return { wa, wb, wc };
}

// ---- Polygon helpers (feet) ------------------------------------------------

/** Shoelace area in square feet (always non-negative). */
export function polygonAreaSF(poly: Pt2[]): number {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(x: number, y: number, poly: Pt2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const hit =
      (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number; }

export function bbox(poly: Pt2[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
