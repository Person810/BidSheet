import type { TakeoffRun } from './types';
import { inchesToFeet } from '../../../../shared/constants/units';

/**
 * Profile (side-view) model for a pipe run.
 *
 * Pure math, no React: converts a drawn run plus its trench parameters into
 * stations and elevations ready to plot. Two modes:
 *
 *  - 'elevation': at least one vertex has a surveyed invert elevation.
 *    Known inverts anchor the profile; unknown vertices interpolate between
 *    anchors and extrapolate past them at the run's design grade. Ground
 *    follows known rim elevations (flat past the ends); with no rims it sits
 *    a constant start-depth above the first invert.
 *
 *  - 'depth': nothing surveyed. Ground is a flat datum at 0 and the invert
 *    falls from -startDepth at the run's design grade.
 */

export interface ProfileStation {
  /** Distance along the run in feet */
  station: number;
  /** Pipe invert elevation (ft) */
  invert: number;
  /** Ground / finished grade elevation (ft) */
  ground: number;
  /** Surveyed values, when the vertex carried them */
  knownInvert: boolean;
  rim: number | null;
  structureType: string | null;
}

export interface RunProfile {
  mode: 'elevation' | 'depth';
  stations: ProfileStation[];
  totalLengthFt: number;
  pipeDiaFt: number;
  beddingDepthFt: number;
  /** Plot range: deepest trench bottom to highest ground */
  minElev: number;
  maxElev: number;
  /** True when the ground line is assumed rather than from rim elevations */
  groundAssumed: boolean;
}

interface Anchor { s: number; v: number; }

/**
 * Value at station s given sorted anchors: linear between anchors,
 * slope-extrapolated past the ends (slopePerFt may be 0 for flat).
 */
function interpolate(anchors: Anchor[], s: number, slopePerFt: number): number {
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (s <= first.s) return first.v + (first.s - s) * slopePerFt;
  if (s >= last.s) return last.v - (s - last.s) * slopePerFt;
  for (let i = 1; i < anchors.length; i++) {
    if (s <= anchors[i].s) {
      const a = anchors[i - 1];
      const b = anchors[i];
      const t = b.s === a.s ? 0 : (s - a.s) / (b.s - a.s);
      return a.v + (b.v - a.v) * t;
    }
  }
  return last.v;
}

/**
 * Optional existing-ground lookup, in PDF-pixel space (the same coordinates a
 * run's vertices use). Returns the surveyed/interpolated ground elevation in
 * feet at (xPx, yPx), or null when that spot is outside the surface data.
 * Built by the caller from a TakeoffSurface TIN.
 */
export type GroundSampler = (xPx: number, yPx: number) => number | null;

export function buildRunProfile(
  run: TakeoffRun,
  scalePxPerFt: number,
  groundSampler?: GroundSampler,
): RunProfile | null {
  if (run.points.length < 2 || scalePxPerFt <= 0) return null;

  // Stations from cumulative plan-view distance
  const stations: number[] = [0];
  for (let i = 1; i < run.points.length; i++) {
    const dx = run.points[i].x - run.points[i - 1].x;
    const dy = run.points[i].y - run.points[i - 1].y;
    stations.push(stations[i - 1] + Math.sqrt(dx * dx + dy * dy) / scalePxPerFt);
  }
  const totalLengthFt = stations[stations.length - 1];
  if (totalLengthFt <= 0) return null;

  // Design grade: pipes fall in the drawn direction (ft drop per ft run)
  const gradePerFt = (run.gradePct || 0) / 100;

  const invertAnchors: Anchor[] = [];
  const rimAnchors: Anchor[] = [];
  run.points.forEach((p, i) => {
    if (p.invertElev != null) invertAnchors.push({ s: stations[i], v: p.invertElev });
    if (p.rimElev != null) rimAnchors.push({ s: stations[i], v: p.rimElev });
  });

  // Sample the existing-ground surface at each vertex, when one is supplied.
  const sampledGround = run.points.map((p) =>
    groundSampler ? groundSampler(p.x, p.y) : null);
  const hasSampledGround = sampledGround.some((z) => z != null);
  const sampledAnchors: Anchor[] = [];
  run.points.forEach((_p, i) => {
    if (sampledGround[i] != null) sampledAnchors.push({ s: stations[i], v: sampledGround[i] as number });
  });

  // With no surveyed inverts but a real surface (sampled TIN or rim elevations),
  // anchor the run to the terrain: ground follows the existing grade and the pipe
  // falls at design grade from start depth below the upstream ground. Otherwise
  // fall back to the flat depth datum. Surveyed inverts always win.
  const terrainDriven = invertAnchors.length === 0 && (hasSampledGround || rimAnchors.length > 0);
  const mode: RunProfile['mode'] = invertAnchors.length > 0 || terrainDriven ? 'elevation' : 'depth';
  const groundAssumed = rimAnchors.length === 0 && !hasSampledGround;

  const groundFromSurface = (s: number): number | null => {
    if (rimAnchors.length > 0) return interpolate(rimAnchors, s, 0);
    if (sampledAnchors.length > 0) return interpolate(sampledAnchors, s, 0);
    return null;
  };
  // Rim anchors provide absolute ground elevation when no sampled surface exists.
  const terrainStartGround = sampledAnchors.length > 0 ? sampledAnchors[0].v :
    rimAnchors.length > 0 ? rimAnchors[0].v : 0;

  const invertAt = (s: number): number => {
    if (invertAnchors.length > 0) return interpolate(invertAnchors, s, gradePerFt);
    if (terrainDriven) return terrainStartGround - run.startDepthFt - s * gradePerFt;
    return -(run.startDepthFt + s * gradePerFt);
  };
  const groundAt = (s: number): number => {
    const surf = groundFromSurface(s);
    if (surf != null) return surf;
    if (mode === 'depth') return 0;
    return invertAt(0) + run.startDepthFt;
  };

  const out: ProfileStation[] = run.points.map((p, i) => ({
    station: stations[i],
    invert: p.invertElev ?? invertAt(stations[i]),
    ground: p.rimElev ?? groundAt(stations[i]),
    knownInvert: p.invertElev != null,
    rim: p.rimElev ?? null,
    structureType: p.structureType ?? null,
  }));

  const pipeDiaFt = inchesToFeet(run.pipeSizeIn || 0);
  const beddingDepthFt = run.beddingDepthFt || 0;
  const minElev = Math.min(...out.map((st) => st.invert)) - beddingDepthFt;
  const maxElev = Math.max(...out.map((st) => st.ground), ...out.map((st) => st.invert + pipeDiaFt));

  return { mode, stations: out, totalLengthFt, pipeDiaFt, beddingDepthFt, minElev, maxElev, groundAssumed };
}

/** Pick a tick interval giving roughly 4-8 ticks over the span. */
export function niceTickStep(span: number): number {
  const steps = [0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
  for (const step of steps) {
    if (span / step <= 8) return step;
  }
  return 1000;
}

/** Grade of each segment in percent, from the resolved invert profile. */
export function segmentGrades(profile: RunProfile): number[] {
  const grades: number[] = [];
  for (let i = 1; i < profile.stations.length; i++) {
    const a = profile.stations[i - 1];
    const b = profile.stations[i];
    const len = b.station - a.station;
    grades.push(len > 0 ? ((a.invert - b.invert) / len) * 100 : 0);
  }
  return grades;
}
