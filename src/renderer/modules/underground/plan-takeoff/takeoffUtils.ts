import type { TakeoffRun, PdfPoint } from './types';
import { INCHES_PER_FOOT } from '../../../../shared/constants/units';

/** OSHA 1926 Subpart P general threshold for protective systems */
export const SHORING_DEPTH_THRESHOLD_FT = 5;

/** Snap-to-node radius in PDF-native pixels */
export const NODE_SNAP_RADIUS_PX = 15;

/** Sum pixel distances between consecutive points, convert to linear feet. */
export function computeRunLengthLF(points: PdfPoint[], scalePxPerFt: number): number {
  let totalPx = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    totalPx += Math.sqrt(dx * dx + dy * dy);
  }
  return scalePxPerFt > 0 ? totalPx / scalePxPerFt : 0;
}

/* ---- Polygon geometry for area takeoff ---- */

/** Convert a depth in feet to inches, rounded to 2 decimals for display/grouping. */
export function ftToInches(ft: number): number {
  return Math.round(ft * INCHES_PER_FOOT * 100) / 100;
}

/** Load all page scale calibrations for a job as a page-number → px/ft map. */
export async function loadPageScaleMap(jobId: number): Promise<Map<number, number>> {
  const scales: { page_number: number; scale_px_per_ft: number }[] =
    await window.api.listPageScales(jobId);
  return new Map(scales.map((s) => [s.page_number, s.scale_px_per_ft]));
}

/** Polygon area via the shoelace formula, converted to square feet. */
export function computePolygonAreaSF(points: PdfPoint[], scalePxPerFt: number): number {
  if (points.length < 3 || scalePxPerFt <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    sum += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(sum / 2) / (scalePxPerFt * scalePxPerFt);
}

/** Closed-polygon perimeter in linear feet. */
export function computePolygonPerimeterLF(points: PdfPoint[], scalePxPerFt: number): number {
  if (points.length < 2 || scalePxPerFt <= 0) return 0;
  let totalPx = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    totalPx += segmentLengthPx(p1, p2);
  }
  return totalPx / scalePxPerFt;
}

/** Polygon centroid (falls back to vertex average for degenerate polygons). */
export function polygonCentroid(points: PdfPoint[]): PdfPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  let signedArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const cross = p1.x * p2.y - p2.x * p1.y;
    signedArea += cross;
    cx += (p1.x + p2.x) * cross;
    cy += (p1.y + p2.y) * cross;
  }
  if (Math.abs(signedArea) < 1e-6) {
    const sx = points.reduce((s, p) => s + p.x, 0);
    const sy = points.reduce((s, p) => s + p.y, 0);
    return { x: sx / points.length, y: sy / points.length };
  }
  return { x: cx / (3 * signedArea), y: cy / (3 * signedArea) };
}

/**
 * Constrain a point to the nearest axis through the anchor (ortho/Shift
 * drawing). Returns the point unchanged when there is no anchor.
 */
export function orthoConstrainPoint(point: PdfPoint, anchor: PdfPoint | null | undefined): PdfPoint {
  if (!anchor) return point;
  const dx = Math.abs(point.x - anchor.x);
  const dy = Math.abs(point.y - anchor.y);
  return dx >= dy ? { x: point.x, y: anchor.y } : { x: anchor.x, y: point.y };
}

/* ---- Marquee selection ---- */

export interface MarqueeRect { x: number; y: number; w: number; h: number; }

export function rectContains(rect: MarqueeRect, p: PdfPoint): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
}

/** Normalize two corner points into an x/y/w/h rectangle. */
export function normalizeRect(p1: PdfPoint, p2: PdfPoint): MarqueeRect {
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    w: Math.abs(p2.x - p1.x),
    h: Math.abs(p2.y - p1.y),
  };
}

/* ---- Geometry helpers for callout labels ---- */

/** Midpoint of a segment. */
export function segmentMidpoint(p1: PdfPoint, p2: PdfPoint): PdfPoint {
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
}

/** Euclidean distance between two points. */
export function segmentLengthPx(p1: PdfPoint, p2: PdfPoint): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Segment angle in degrees, normalized so text never appears upside-down. */
export function segmentAngleDeg(p1: PdfPoint, p2: PdfPoint): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  let angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return angle;
}

/**
 * Shift the midpoint of a segment perpendicular to it by `distance` PDF units.
 * `side` controls direction: 'left' rotates the segment direction -90 deg,
 * 'right' rotates +90 deg.
 */
export function perpendicularOffset(
  p1: PdfPoint, p2: PdfPoint, distance: number, side: 'left' | 'right',
): PdfPoint {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return segmentMidpoint(p1, p2);
  // Unit normal: rotate direction vector 90 degrees
  const nx = side === 'left' ? dy / len : -dy / len;
  const ny = side === 'left' ? -dx / len : dx / len;
  const mid = segmentMidpoint(p1, p2);
  return { x: mid.x + nx * distance, y: mid.y + ny * distance };
}

/* ---- Label chrome ----
 * Run callouts and area labels are annotation, not drawing content, so they
 * share one look and one on-screen size. Handles and symbols deliberately do
 * NOT use these — those stay proportional to the sheet so they remain easy to
 * grab on a large plan.
 */

/** Pill fill behind label text. */
export const LABEL_BG = 'rgba(22,24,28,0.82)';

/** Ceiling on label text height, in CSS px. */
export const LABEL_MAX_PX = 13;

/**
 * Clamp a page-relative label size to a fixed on-screen height.
 *
 * `rawSize` is in page units and `pxPerUnit` is the rendered scale, so
 * `rawSize * pxPerUnit` is what the user actually sees. Sizes derived from
 * page width balloon on large civil sheets (~30px) while sitting near 8px on
 * a letter page; capping keeps big sheets readable and leaves small ones as
 * they were. Falls back to `rawSize` for a non-positive scale.
 */
export function cappedLabelSize(rawSize: number, pxPerUnit: number): number {
  if (!(pxPerUnit > 0)) return rawSize;
  return Math.min(rawSize, LABEL_MAX_PX / pxPerUnit);
}

/**
 * Where a leader line from `boxCenter` toward `anchorPoint` crosses the box
 * border. Unlike snapping to the midpoint of the nearest edge, this exits at
 * the true angle of the leader, so the line reads as one straight run from
 * label to measurement instead of kinking at the box.
 *
 * Returns the center itself for a degenerate (zero-length) direction.
 */
export function calloutEdgePoint(
  boxCenter: PdfPoint, anchorPoint: PdfPoint,
  boxHalfW: number, boxHalfH: number,
): PdfPoint {
  const dx = anchorPoint.x - boxCenter.x;
  const dy = anchorPoint.y - boxCenter.y;
  if (dx === 0 && dy === 0) return boxCenter;

  // Largest t where center + d*t still sits inside the half-extents; the
  // limiting axis is whichever border the ray reaches first.
  const tx = dx === 0 ? Infinity : boxHalfW / Math.abs(dx);
  const ty = dy === 0 ? Infinity : boxHalfH / Math.abs(dy);
  const t = Math.min(tx, ty);

  return { x: boxCenter.x + dx * t, y: boxCenter.y + dy * t };
}

/** If distance from origin to target exceeds maxRadius, clamp to the circle edge. */
export function clampToRadius(origin: PdfPoint, target: PdfPoint, maxRadius: number): PdfPoint {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= maxRadius) return target;
  const scale = maxRadius / dist;
  return { x: origin.x + dx * scale, y: origin.y + dy * scale };
}

/** Maximum trench depth across the run (start vs end). */
export function getMaxDepthFt(run: TakeoffRun, scalePxPerFt: number): number {
  const runLengthLF = computeRunLengthLF(run.points, scalePxPerFt);
  const endDepthFt = run.startDepthFt + (run.gradePct / 100) * runLengthLF;
  return Math.max(run.startDepthFt, endDepthFt);
}
