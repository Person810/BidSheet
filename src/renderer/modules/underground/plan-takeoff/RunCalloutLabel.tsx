import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { PdfPoint } from './types';
import {
  segmentMidpoint, segmentLengthPx, perpendicularOffset,
  trianglePointerVertices,
} from './takeoffUtils';

/* ---- Constants ---- */

const CALLOUT_BG = 'rgba(30,30,30,0.85)';
const CALLOUT_BORDER = 'rgba(255,255,255,0.15)';
const SNAP_BACK_MS = 250;        // animation duration

// Spatial constants as multiples of fontSize (so they scale with zoom)
const OFFSET_RATIO = 4.5;        // perpendicular offset = fontSize * this
const MAX_DRAG_RATIO = 22;       // snap-back threshold = fontSize * this
const TRI_BASE_RATIO = 1;        // triangle base width = fontSize * this
const MIN_TRI_RATIO = 1;         // hide triangle if dist < fontSize * this

interface RunCalloutLabelProps {
  p1: PdfPoint;
  p2: PdfPoint;
  scalePxPerFt: number;
  fontSize: number;
  color: string;
  segmentIndex: number;
  scale: number;
  isActive: boolean;
}

export default function RunCalloutLabel({
  p1, p2, scalePxPerFt, fontSize, color, segmentIndex, scale, isActive,
}: RunCalloutLabelProps) {
  const distPx = segmentLengthPx(p1, p2);
  if (distPx < 1) return null;
  const distFt = distPx / scalePxPerFt;
  if (distFt < 1.5) return null;

  const label = `${distFt.toFixed(1)}'`;

  // Sizing
  const padH = fontSize * 0.5;
  const padV = fontSize * 0.25;
  const textW = label.length * fontSize * 0.55;
  const boxW = textW + padH * 2;
  const boxH = fontSize + padV * 2;
  const halfW = boxW / 2;
  const halfH = boxH / 2;

  // Derive spatial constants from fontSize (scales with zoom)
  const labelOffset = fontSize * OFFSET_RATIO;
  const maxDragRadius = fontSize * MAX_DRAG_RATIO;
  const triBase = fontSize * TRI_BASE_RATIO;
  const minTriLen = fontSize * MIN_TRI_RATIO;

  // Anchor = midpoint on the pipe segment (triangle tip points here)
  const anchor = segmentMidpoint(p1, p2);

  // Default label center = offset perpendicular to segment
  const side: 'left' | 'right' = segmentIndex % 2 === 0 ? 'left' : 'right';
  const defaultCenter = perpendicularOffset(p1, p2, labelOffset, side);

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

  // Resolved label center
  const labelCenter: PdfPoint = dragOffset
    ? { x: defaultCenter.x + dragOffset.x, y: defaultCenter.y + dragOffset.y }
    : defaultCenter;

  // Triangle geometry
  const triDist = segmentLengthPx(labelCenter, anchor);
  const showTriangle = triDist > minTriLen;
  const triVerts = showTriangle
    ? trianglePointerVertices(labelCenter, anchor, halfW, halfH, triBase)
    : null;

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
      const dx = (ev.clientX - dragStartRef.current.mouseX) / scale;
      const dy = (ev.clientY - dragStartRef.current.mouseY) / scale;
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
  }, [isActive, scale, dragOffset, startSnapBack, maxDragRadius]);

  /* ---- Render ---- */

  const pointerEvents = isActive ? 'none' as const : 'auto' as const;
  const cursor = isDraggingRef.current ? 'grabbing' : 'grab';

  return (
    <g style={{ pointerEvents: 'none' }}>
      {/* Triangle pointer */}
      {triVerts && (
        <polygon
          points={triVerts.map((v) => `${v.x},${v.y}`).join(' ')}
          fill={CALLOUT_BG}
          stroke={CALLOUT_BORDER}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Background box (interactive — receives drag) */}
      <rect
        x={labelCenter.x - halfW}
        y={labelCenter.y - halfH}
        width={boxW}
        height={boxH}
        fill={CALLOUT_BG}
        stroke={CALLOUT_BORDER}
        strokeWidth={1}
        rx={4}
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
        fontWeight={500}
        style={{ userSelect: 'none', pointerEvents: 'none' }}
      >
        {label}
      </text>
    </g>
  );
}
