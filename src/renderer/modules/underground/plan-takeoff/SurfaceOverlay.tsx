import React, { useMemo } from 'react';
import type { SurfacePoint, TakeoffArea } from './types';
import { buildTin, interpolateZ, bbox, pointInPolygon, type Pt3 } from '../surfaceModel';

interface SurfaceOverlayProps {
  /** Spot elevations for the current page (PDF px + elevation ft). */
  points: SurfacePoint[];
  /** Earthwork areas on the current page (for the finished-elevation heatmap). */
  areas: TakeoffArea[];
  scalePxPerFt: number | null;
  showHeatmap: boolean;
  showPoints: boolean;
}

const CUT = '239, 68, 68';   // red — existing above finished grade
const FILL = '59, 130, 246'; // blue — existing below finished grade

/**
 * SVG layer (drawn in PDF coordinates inside the DrawingOverlay) for the
 * existing-ground surface: spot-elevation markers and an optional cut/fill
 * heatmap for finished-elevation earthwork regions. Pure rendering — all the
 * geometry it needs is passed in.
 */
export default function SurfaceOverlay({
  points, areas, scalePxPerFt, showHeatmap, showPoints,
}: SurfaceOverlayProps) {
  const spp = scalePxPerFt && scalePxPerFt > 0 ? scalePxPerFt : 10;
  const r = spp * 0.35;
  const fs = spp * 0.9;

  // Heatmap cells, computed in PDF px against a TIN of the page's spot elevations.
  const cells = useMemo(() => {
    if (!showHeatmap) return [];
    const finishedAreas = areas.filter((a) => a.gradeMode === 'finished_elev' && a.points.length >= 3);
    if (finishedAreas.length === 0 || points.length < 3) return [];
    const tin = buildTin(points.map((p): Pt3 => ({ x: p.x, y: p.y, z: p.z })));
    if (tin.triangles.length === 0) return [];

    const cellPx = spp * 10; // 10 ft grid
    const out: { x: number; y: number; size: number; color: string }[] = [];
    for (const area of finishedAreas) {
      const finished = area.gradeValueFt ?? 0;
      const box = bbox(area.points);
      for (let x = box.minX + cellPx / 2; x <= box.maxX; x += cellPx) {
        for (let y = box.minY + cellPx / 2; y <= box.maxY; y += cellPx) {
          if (!pointInPolygon(x, y, area.points)) continue;
          const z = interpolateZ(tin, x, y);
          if (z == null) continue;
          const dz = z - finished;
          const alpha = Math.min(Math.abs(dz) / 5, 0.65) + 0.1;
          const color = `rgba(${dz >= 0 ? CUT : FILL}, ${alpha.toFixed(2)})`;
          out.push({ x: x - cellPx / 2, y: y - cellPx / 2, size: cellPx, color });
        }
      }
    }
    return out;
  }, [showHeatmap, areas, points, spp]);

  return (
    <g style={{ pointerEvents: 'none' }}>
      {cells.map((c, i) => (
        <rect key={`hm${i}`} x={c.x} y={c.y} width={c.size} height={c.size} fill={c.color} />
      ))}
      {showPoints && points.map((p, i) => (
        <g key={`sp${i}`}>
          <circle cx={p.x} cy={p.y} r={r} fill="#22c55e" stroke="#0b3b1a"
            strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <text x={p.x + r * 1.4} y={p.y + fs * 0.35} fontSize={fs} fill="#22c55e"
            stroke="#0b1220" strokeWidth={fs * 0.06} paintOrder="stroke">
            {p.z.toFixed(1)}
          </text>
        </g>
      ))}
    </g>
  );
}
