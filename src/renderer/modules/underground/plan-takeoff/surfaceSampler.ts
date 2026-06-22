import { buildTin, interpolateZ, type Pt3, type Tin } from '../surfaceModel';
import type { GroundSampler } from './profileModel';
import type { TakeoffSurface } from './types';

/**
 * Build a ground-elevation sampler for one PDF page from an existing surface.
 *
 * The TIN is built in PDF-pixel space (the same coordinates run vertices and
 * area polygons use), with elevation in feet riding along on each point, so a
 * run can be grounded against real terrain without any scale conversion.
 * Returns undefined when there isn't enough data on the page to triangulate.
 */
export function buildGroundSampler(
  surface: TakeoffSurface | null | undefined,
  pdfPage: number,
): GroundSampler | undefined {
  if (!surface) return undefined;
  const pts: Pt3[] = surface.points
    .filter((p) => p.pdfPage === pdfPage)
    .map((p) => ({ x: p.x, y: p.y, z: p.z }));
  if (pts.length < 3) return undefined;
  const tin = buildTin(pts);
  if (tin.triangles.length === 0) return undefined;
  return (xPx, yPx) => interpolateZ(tin, xPx, yPx);
}

/**
 * Return the raw TIN for a page so a 3D view can render the terrain mesh
 * directly from the triangles rather than sampling through the closure.
 * Points are in PDF-pixel XY with elevation in feet as Z.
 */
export function buildGroundTin(
  surface: TakeoffSurface | null | undefined,
  pdfPage: number,
): Tin | undefined {
  if (!surface) return undefined;
  const pts: Pt3[] = surface.points
    .filter((p) => p.pdfPage === pdfPage)
    .map((p) => ({ x: p.x, y: p.y, z: p.z }));
  if (pts.length < 3) return undefined;
  const tin = buildTin(pts);
  return tin.triangles.length === 0 ? undefined : tin;
}
