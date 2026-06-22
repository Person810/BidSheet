import type { TakeoffRun } from './types';
import { buildRunProfile } from './profileModel';

/**
 * 3D model for a pipe run -- the spatial counterpart to profileModel.ts.
 *
 * Pure math, no React and no three.js: converts a drawn run plus its trench
 * parameters into world-space geometry (in feet) ready to hand to a renderer.
 * Elevations come straight from buildRunProfile so the 3D view and the 2D
 * profile always agree; horizontal position follows the drawn plan polyline.
 *
 * World axes: X = plan east, Z = plan south (PDF +y is down), Y = up.
 * Everything is true 1:1 scale -- no vertical exaggeration -- because in 3D
 * there's no narrow plot to squeeze depths into.
 */

export interface Trench3DSegment {
  /** Segment endpoints in world feet (horizontal plane) */
  ax: number; az: number;
  bx: number; bz: number;
  /** Ground / finished-grade elevation at each end (ft) */
  groundA: number; groundB: number;
  /** Pipe invert elevation at each end (ft) */
  invertA: number; invertB: number;
  /** Trench bottom (invert - bedding depth) at each end (ft) */
  bottomA: number; bottomB: number;
}

export interface Trench3DStructure {
  x: number; z: number;
  ground: number;
  invert: number;
  type: string | null;
}

export interface Trench3DModel {
  segments: Trench3DSegment[];
  /** Pipe centerline (invert + radius) in world feet, for sweeping a tube */
  pipeCenterline: { x: number; y: number; z: number }[];
  /** Full excavated width including benches each side (ft) */
  totalWidthFt: number;
  /** Bedding/pipe-zone width, i.e. the nominal trench width (ft) */
  trenchWidthFt: number;
  pipeDiaFt: number;
  beddingDepthFt: number;
  structures: Trench3DStructure[];
  /** Bounding-sphere center and radius for framing the camera (world ft) */
  center: { x: number; y: number; z: number };
  radius: number;
  mode: 'elevation' | 'depth';
  totalLengthFt: number;
  groundAssumed: boolean;
}

export function buildRunGeometry(run: TakeoffRun, scalePxPerFt: number): Trench3DModel | null {
  const profile = buildRunProfile(run, scalePxPerFt);
  if (!profile || run.points.length < 2) return null;

  // Center the horizontal layout on the polyline centroid so the model sits
  // near the world origin -- keeps orbit/zoom math well-conditioned.
  let cx = 0;
  let cy = 0;
  for (const p of run.points) { cx += p.x; cy += p.y; }
  cx /= run.points.length;
  cy /= run.points.length;
  const toX = (px: number) => (px - cx) / scalePxPerFt;
  const toZ = (py: number) => (py - cy) / scalePxPerFt;

  const st = profile.stations;
  const totalWidthFt = run.trenchWidthFt + run.benchWidthFt * 2;
  const pipeRadiusFt = profile.pipeDiaFt / 2;

  const segments: Trench3DSegment[] = [];
  for (let i = 1; i < run.points.length; i++) {
    const a = run.points[i - 1];
    const b = run.points[i];
    segments.push({
      ax: toX(a.x), az: toZ(a.y),
      bx: toX(b.x), bz: toZ(b.y),
      groundA: st[i - 1].ground, groundB: st[i].ground,
      invertA: st[i - 1].invert, invertB: st[i].invert,
      bottomA: st[i - 1].invert - profile.beddingDepthFt,
      bottomB: st[i].invert - profile.beddingDepthFt,
    });
  }

  // Pipe centerline sits a pipe-radius above the invert.
  const pipeCenterline = run.points.map((p, i) => ({
    x: toX(p.x),
    y: st[i].invert + pipeRadiusFt,
    z: toZ(p.y),
  }));

  const structures: Trench3DStructure[] = st
    .filter((s) => s.structureType || s.rim != null)
    .map((s, idx) => {
      // station index back to the matching plan vertex
      const vi = st.indexOf(s);
      const p = run.points[vi >= 0 ? vi : idx];
      return { x: toX(p.x), z: toZ(p.y), ground: s.ground, invert: s.invert, type: s.structureType };
    });

  // Bounding box -> sphere for camera framing.
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const s of segments) {
    minX = Math.min(minX, s.ax, s.bx); maxX = Math.max(maxX, s.ax, s.bx);
    minZ = Math.min(minZ, s.az, s.bz); maxZ = Math.max(maxZ, s.az, s.bz);
    minY = Math.min(minY, s.bottomA, s.bottomB);
    maxY = Math.max(maxY, s.groundA, s.groundB);
  }
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
  const radius = Math.max(
    0.5 * Math.hypot(maxX - minX, maxY - minY, maxZ - minZ),
    totalWidthFt,
  );

  return {
    segments,
    pipeCenterline,
    totalWidthFt,
    trenchWidthFt: run.trenchWidthFt,
    pipeDiaFt: profile.pipeDiaFt,
    beddingDepthFt: profile.beddingDepthFt,
    structures,
    center,
    radius,
    mode: profile.mode,
    totalLengthFt: profile.totalLengthFt,
    groundAssumed: profile.groundAssumed,
  };
}

/**
 * Eight corners of one swept trapezoidal prism segment, ordered
 * [bot: aL,aR,bR,bL ; top: aL,aR,bR,bL]. Pure geometry so the renderer can
 * turn it straight into a BufferGeometry. `topOf`/`botOf` pick which pair of
 * elevations (ground/invert/bottom) bound this prism, letting one helper build
 * both the excavation envelope and the bedding zone.
 */
export function prismCorners(
  seg: Trench3DSegment,
  halfWidthFt: number,
  topA: number, topB: number,
  botA: number, botB: number,
): number[] {
  // Right-hand normal to the segment in the horizontal plane.
  const dx = seg.bx - seg.ax;
  const dz = seg.bz - seg.az;
  const len = Math.hypot(dx, dz) || 1;
  const rx = (dz / len) * halfWidthFt;
  const rz = (-dx / len) * halfWidthFt;

  const aLx = seg.ax - rx, aLz = seg.az - rz;
  const aRx = seg.ax + rx, aRz = seg.az + rz;
  const bLx = seg.bx - rx, bLz = seg.bz - rz;
  const bRx = seg.bx + rx, bRz = seg.bz + rz;

  return [
    // bottom face: aL, aR, bR, bL
    aLx, botA, aLz,  aRx, botA, aRz,  bRx, botB, bRz,  bLx, botB, bLz,
    // top face: aL, aR, bR, bL
    aLx, topA, aLz,  aRx, topA, aRz,  bRx, topB, bRz,  bLx, topB, bLz,
  ];
}

/** Triangle indices for the 8-corner prism from prismCorners (12 tris). */
export const PRISM_INDICES: number[] = [
  0, 1, 2, 0, 2, 3,       // bottom
  4, 6, 5, 4, 7, 6,       // top
  0, 5, 1, 0, 4, 5,       // a-end
  3, 2, 6, 3, 6, 7,       // b-end
  0, 3, 7, 0, 7, 4,       // left
  1, 5, 6, 1, 6, 2,       // right
];
