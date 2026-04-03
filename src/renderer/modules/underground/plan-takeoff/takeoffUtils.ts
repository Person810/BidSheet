import type { TakeoffRun, PdfPoint } from './types';

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

/**
 * Compute the 3 vertices of a triangular pointer from a box edge to an anchor point.
 * Returns [baseLeft, baseRight, tip] where tip is the anchor point and
 * the base sits on the nearest edge of the bounding box.
 */
export function trianglePointerVertices(
  boxCenter: PdfPoint, anchorPoint: PdfPoint,
  boxHalfW: number, boxHalfH: number, baseWidth: number,
): [PdfPoint, PdfPoint, PdfPoint] {
  const dx = anchorPoint.x - boxCenter.x;
  const dy = anchorPoint.y - boxCenter.y;
  const angle = Math.atan2(dy, dx);
  const absAngle = Math.abs(angle);

  // Determine which edge the pointer exits from
  let edgeX: number, edgeY: number;
  if (absAngle < Math.PI / 4 || absAngle > (3 * Math.PI) / 4) {
    // Left or right edge
    edgeX = boxCenter.x + (dx > 0 ? boxHalfW : -boxHalfW);
    edgeY = boxCenter.y;
    // Base perpendicular to horizontal = vertical offsets
    return [
      { x: edgeX, y: edgeY - baseWidth / 2 },
      { x: edgeX, y: edgeY + baseWidth / 2 },
      anchorPoint,
    ];
  } else {
    // Top or bottom edge
    edgeX = boxCenter.x;
    edgeY = boxCenter.y + (dy > 0 ? boxHalfH : -boxHalfH);
    // Base perpendicular to vertical = horizontal offsets
    return [
      { x: edgeX - baseWidth / 2, y: edgeY },
      { x: edgeX + baseWidth / 2, y: edgeY },
      anchorPoint,
    ];
  }
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
