import React from 'react';
import type { PdfPoint, TakeoffWall } from './types';
import { computeRunLengthLF, segmentMidpoint } from './takeoffUtils';
import { formatQty } from '../../../../shared/unitSystem';
import { useUnitSystem } from '../../../stores/units-store';

interface WallOverlayProps {
  walls: TakeoffWall[];
  activeWallId: number | null;
  selectedWallId: number | null;
  /** Rubber-band target for the wall being drawn. */
  mousePosition: PdfPoint | null;
  scalePxPerFt: number | null;
  /** True when no drawing/calibration is in progress, so clicks can select. */
  interactive: boolean;
  onSelect?: (wallId: number | null) => void;
}

/**
 * SVG layer (drawn in PDF coordinates inside DrawingOverlay) for wall runs.
 * Walls are open polylines, so — unlike area polygons — the path is never
 * closed. Pure rendering; all geometry is passed in. Editing happens via the
 * summary panel and the config modal, keeping this layer simple and isolated
 * from the run/area drag machinery.
 */
export default function WallOverlay({
  walls, activeWallId, selectedWallId, mousePosition, scalePxPerFt, interactive, onSelect,
}: WallOverlayProps) {
  const system = useUnitSystem();
  const spp = scalePxPerFt && scalePxPerFt > 0 ? scalePxPerFt : 10;
  const r = spp * 0.3;
  const fs = spp * 0.95;

  return (
    <g>
      {walls.map((wall) => {
        const isActive = wall.id === activeWallId;
        const isSelected = wall.id === selectedWallId;
        const pts = isActive && mousePosition ? [...wall.points, mousePosition] : wall.points;
        if (pts.length === 0) return null;
        const pointsAttr = pts.map((p) => `${p.x},${p.y}`).join(' ');
        const lengthLF = scalePxPerFt ? computeRunLengthLF(pts, scalePxPerFt) : 0;
        // Label at the midpoint of the longest-so-far path: use the middle segment.
        const midIdx = Math.max(0, Math.floor((pts.length - 1) / 2));
        const labelAnchor = pts.length >= 2
          ? segmentMidpoint(pts[midIdx], pts[midIdx + 1] ?? pts[midIdx])
          : pts[0];

        return (
          <g key={wall.id}>
            {/* Hit target (wide, transparent) for selection */}
            {interactive && !isActive && wall.points.length >= 2 && (
              <polyline
                points={wall.points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="transparent"
                strokeWidth={r * 3}
                style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                onClick={(e) => { e.stopPropagation(); onSelect?.(wall.id); }}
              />
            )}
            <polyline
              points={pointsAttr}
              fill="none"
              stroke={wall.color}
              strokeWidth={isSelected ? r * 1.1 : r * 0.7}
              strokeOpacity={isActive ? 0.9 : 1}
              strokeDasharray={isActive ? `${spp * 0.5} ${spp * 0.3}` : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'none' }}
            />
            {wall.points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={r}
                fill={isSelected ? '#fff' : wall.color}
                stroke={wall.color} strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'none' }} />
            ))}
            {lengthLF > 0 && (
              <text x={labelAnchor.x} y={labelAnchor.y - r * 1.5} fontSize={fs}
                fill={wall.color} stroke="#0b1220" strokeWidth={fs * 0.06} paintOrder="stroke"
                textAnchor="middle" style={{ pointerEvents: 'none' }}>
                {wall.label ? `${wall.label} · ` : ''}
                {system === 'metric' ? formatQty(lengthLF, 'lf', system, 1) : `${lengthLF.toFixed(1)} LF`}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
