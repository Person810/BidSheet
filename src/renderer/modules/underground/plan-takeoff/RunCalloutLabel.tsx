import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { PdfPoint } from './types';
import {
  segmentMidpoint, segmentLengthPx, perpendicularOffset,
  calloutEdgePoint, LABEL_BG,
} from './takeoffUtils';
import { formatQty } from '../../../../shared/unitSystem';
import { useUnitSystem } from '../../../stores/units-store';

/* ---- Constants ---- */

const SNAP_BACK_MS = 250;        // animation duration

// Spatial constants as multiples of fontSize (so they scale with zoom)
const OFFSET_RATIO = 4.5;        // perpendicular offset = fontSize * this
const MAX_DRAG_RATIO = 22;       // snap-back threshold = fontSize * this
const MIN_LEADER_RATIO = 1;      // hide leader if dist < fontSize * this

interface RunCalloutLabelProps {
  p1: PdfPoint;
  p2: PdfPoint;
  scalePxPerFt: number;
  fontSize: number;
  color: string;
  segmentIndex: number;
  scale: number;
  /** User page rotation in degrees (0/90/180/270); drag deltas are mapped
   *  from the rotated screen frame back into the unrotated page frame. */
  rotation?: number;
  isActive: boolean;
}

const RunCalloutLabel = React.memo(function RunCalloutLabel({
  p1, p2, scalePxPerFt, fontSize, color, segmentIndex, scale, rotation = 0, isActive,
}: RunCalloutLabelProps) {
  const system = useUnitSystem();

  // EVERY hook must run before the short-segment early returns below. They used
  // to sit above this block, which meant a segment crossing the 1.5 ft
  // threshold — routine while dragging a vertex or zooming out — changed this
  // component's hook count between renders and threw "Rendered fewer hooks than
  // expected". Nothing here depends on the measured length, so hoisting is
  // free. Keep it that way: new hooks go above the returns, not below.

  // Derive spatial constants from fontSize (scales with zoom)
  const labelOffset = fontSize * OFFSET_RATIO;
  const maxDragRadius = fontSize * MAX_DRAG_RATIO;
  const minLeaderLen = fontSize * MIN_LEADER_RATIO;

  // Drag state
  const [dragOffset, setDragOffset] = useState<PdfPoint | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, offX: 0, offY: 0 });
  const animFrameRef = useRef<number | null>(null);

  // Reset drag when segment geometry changes (page switch, vertex move)
  useEffect(() => {
    setDragOffset(null);
  }, [p1.x, p1.y, p2.x, p2.y]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current != null) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  /* ---- Snap-back animation ---- */

  const startSnapBack = useCallback((from: PdfPoint) => {
    if (animFrameRef.current != null) cancelAnimationFrame(animFrameRef.current);
    const startTime = performance.now();

    function tick() {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(elapsed / SNAP_BACK_MS, 1);
      const t = 1 - Math.pow(1 - progress, 3); // cubic ease-out

      if (progress < 1) {
        setDragOffset({ x: from.x * (1 - t), y: from.y * (1 - t) });
        animFrameRef.current = requestAnimationFrame(tick);
      } else {
        setDragOffset(null);
        animFrameRef.current = null;
      }
    }

    animFrameRef.current = requestAnimationFrame(tick);
  }, []);

  /* ---- Drag handlers ---- */

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isActive) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    // Cancel any in-progress snap-back
    if (animFrameRef.current != null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    isDraggingRef.current = true;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      offX: dragOffset?.x ?? 0,
      offY: dragOffset?.y ?? 0,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const sx = (ev.clientX - dragStartRef.current.mouseX) / scale;
      const sy = (ev.clientY - dragStartRef.current.mouseY) / scale;
      // The label lives in the unrotated page frame while the mouse moves in
      // the rotated screen frame, so apply the inverse of the overlay's
      // rotation transform to the delta (same mapping as screenToPdf).
      let dx = sx, dy = sy;
      switch (((rotation % 360) + 360) % 360) {
        case 90: dx = sy; dy = -sx; break;
        case 180: dx = -sx; dy = -sy; break;
        case 270: dx = -sy; dy = sx; break;
      }
      setDragOffset({
        x: dragStartRef.current.offX + dx,
        y: dragStartRef.current.offY + dy,
      });
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);

      // Check if beyond snap-back radius
      setDragOffset((current) => {
        if (!current) return null;
        const dist = Math.sqrt(current.x * current.x + current.y * current.y);
        if (dist > maxDragRadius) {
          // Schedule snap-back (can't call startSnapBack inside setState,
          // so use a microtask)
          queueMicrotask(() => startSnapBack(current));
        }
        return current;
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [isActive, scale, rotation, dragOffset, startSnapBack, maxDragRadius]);

  /* ---- Below here is render-only: no hooks past this point ---- */

  const distPx = segmentLengthPx(p1, p2);
  if (distPx < 1) return null;
  const distFt = distPx / scalePxPerFt;
  if (distFt < 1.5) return null;

  const label = system === 'metric' ? formatQty(distFt, 'ft', system, 1) : `${distFt.toFixed(1)}'`;

  // Sizing (fontSize arrives already capped — see DrawingOverlay)
  const padH = fontSize * 0.55;
  const padV = fontSize * 0.3;
  const textW = label.length * fontSize * 0.55;
  const boxW = textW + padH * 2;
  const boxH = fontSize + padV * 2;
  const halfW = boxW / 2;
  const halfH = boxH / 2;

  // Anchor = midpoint on the pipe segment (triangle tip points here)
  const anchor = segmentMidpoint(p1, p2);

  // Default label center = offset perpendicular to segment
  const side: 'left' | 'right' = segmentIndex % 2 === 0 ? 'left' : 'right';
  const defaultCenter = perpendicularOffset(p1, p2, labelOffset, side);

  // Resolved label center
  const labelCenter: PdfPoint = dragOffset
    ? { x: defaultCenter.x + dragOffset.x, y: defaultCenter.y + dragOffset.y }
    : defaultCenter;

  // Leader geometry — a hairline from the box border to the measured segment
  const leaderDist = segmentLengthPx(labelCenter, anchor);
  const showLeader = leaderDist > minLeaderLen;
  const leaderStart = showLeader
    ? calloutEdgePoint(labelCenter, anchor, halfW, halfH)
    : null;

  /* ---- Render ---- */

  const pointerEvents = isActive ? 'none' as const : 'auto' as const;
  const cursor = isDraggingRef.current ? 'grabbing' : 'grab';

  return (
    <g style={{ pointerEvents: 'none' }} opacity={isActive ? 0.75 : 1}>
      {/* Leader — a hairline in the run's color rather than a filled cone, so
          it points at the segment without masking the plan underneath. */}
      {leaderStart && (
        <>
          <line
            x1={leaderStart.x} y1={leaderStart.y}
            x2={anchor.x} y2={anchor.y}
            stroke={color}
            strokeWidth={1.25}
            strokeLinecap="round"
            opacity={0.85}
            vectorEffect="non-scaling-stroke"
            style={{ pointerEvents: 'none' }}
          />
          {/* Dot marks exactly which point the measurement belongs to */}
          <circle
            cx={anchor.x} cy={anchor.y} r={fontSize * 0.16}
            fill={color}
            style={{ pointerEvents: 'none' }}
          />
        </>
      )}

      {/* Pill (interactive — receives drag). Border picks up the run color to
          tie the number to its geometry. */}
      <rect
        x={labelCenter.x - halfW}
        y={labelCenter.y - halfH}
        width={boxW}
        height={boxH}
        fill={LABEL_BG}
        stroke={color}
        strokeWidth={1.25}
        strokeOpacity={0.7}
        rx={boxH * 0.32}
        vectorEffect="non-scaling-stroke"
        style={{ pointerEvents, cursor }}
        onMouseDown={handleMouseDown}
      />

      {/* Label text */}
      <text
        x={labelCenter.x}
        y={labelCenter.y + fontSize * 0.35}
        textAnchor="middle"
        fontSize={fontSize}
        fill="#fff"
        fontFamily="system-ui, sans-serif"
        fontWeight={600}
        letterSpacing={fontSize * 0.01}
        style={{ userSelect: 'none', pointerEvents: 'none' }}
      >
        {label}
      </text>
    </g>
  );
});

export default RunCalloutLabel;
