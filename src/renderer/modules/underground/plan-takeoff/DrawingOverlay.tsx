import React, { useCallback, useRef } from 'react';
import type { PdfPoint, OverlayMode, TakeoffRun, TakeoffItem, TakeoffArea, TakeoffAnnotation, AnnotationKind } from './types';
import ItemSymbols from './ItemSymbols';
import RunCalloutLabel from './RunCalloutLabel';
import AnnotationLayer from './AnnotationLayer';
import {
  getMaxDepthFt, SHORING_DEPTH_THRESHOLD_FT,
  computePolygonAreaSF, polygonCentroid,
} from './takeoffUtils';
import { squareFeetToYards } from '../../../../shared/constants/units';

interface DrawingOverlayProps {
  pageWidth: number;
  pageHeight: number;
  panX: number;
  panY: number;
  cssZoom: number;
  renderedScale: number;
  scale: number;
  /** User page rotation in degrees (0/90/180/270) */
  rotation?: number;
  mode: OverlayMode;
  onPointClick?: (point: PdfPoint) => void;
  children?: React.ReactNode;
  runs?: TakeoffRun[];
  activeRunId?: number | null;
  selectedRunId?: number | null;
  onRunSelect?: (runId: number | null) => void;
  mousePosition?: PdfPoint | null;
  scalePxPerFt?: number | null;
  onMouseMove?: (point: PdfPoint) => void;
  spaceHeld?: boolean;
  items?: TakeoffItem[];
  selectedItemId?: number | null;
  onItemSelect?: (id: number | null) => void;
  /** Fired when user right-clicks a vertex */
  onVertexContextMenu?: (runId: number, vertexIndex: number, screenX: number, screenY: number) => void;
  /** Fired when user right-clicks a segment */
  onSegmentContextMenu?: (runId: number, segmentIndex: number, screenX: number, screenY: number, pdfPoint: PdfPoint) => void;
  /** Fired when user right-clicks an item (fitting or count item) */
  onItemContextMenu?: (itemId: number, screenX: number, screenY: number) => void;
  /** Move-vertex preview state */
  movingVertex?: { runId: number; vertexIndex: number } | null;
  movePreviewPos?: PdfPoint | null;
  /** ID of the node the mouse is near during drawing (for snap highlight) */
  snapNodeId?: number | null;
  /** Page-filtered nodes for snap highlight rendering */
  nodes?: { id: number; xPx: number; yPx: number }[];
  /** Measured surface areas (polygons) */
  areas?: TakeoffArea[];
  activeAreaId?: number | null;
  selectedAreaId?: number | null;
  onAreaSelect?: (areaId: number | null) => void;
  /** Fired when user right-clicks an area polygon */
  onAreaContextMenu?: (areaId: number, screenX: number, screenY: number) => void;
  /** Plan markups (text notes, arrows, revision clouds) */
  annotations?: TakeoffAnnotation[];
  onAnnotationContextMenu?: (id: number, screenX: number, screenY: number) => void;
  annotationPreview?: { kind: AnnotationKind; start: PdfPoint; mouse: PdfPoint } | null;
  /** Marquee multi-selection: highlight sets + the drag rectangle (pdf coords) */
  multiSelected?: { runs: Set<number>; items: Set<number>; areas: Set<number>; annotations: Set<number> } | null;
  marqueeRect?: { x: number; y: number; w: number; h: number } | null;
  /** True when no tool is active, so vertices/items can be dragged directly */
  dragEnabled?: boolean;
  /** Live drag callbacks: commit=false while moving, true once on release */
  onRunVertexDrag?: (runId: number, vertexIndex: number, point: PdfPoint, commit: boolean) => void;
  onAreaVertexDrag?: (areaId: number, vertexIndex: number, point: PdfPoint, commit: boolean) => void;
  onItemDrag?: (itemId: number, point: PdfPoint, commit: boolean) => void;
}

/** Screen-pixel movement below which a mousedown still counts as a click */
const DRAG_THRESHOLD_PX = 3;

type DragTarget =
  | { kind: 'run'; id: number; vertexIndex: number }
  | { kind: 'area'; id: number; vertexIndex: number }
  | { kind: 'item'; id: number };

/**
 * Convert a screen position to PDF coordinates in the UNROTATED page frame
 * (the frame drawings are stored in). pageWidth/pageHeight are the ROTATED
 * page dimensions as reported by the viewer.
 */
function screenToPdf(
  clientX: number, clientY: number, containerRect: DOMRect,
  pageWidth: number, pageHeight: number, panX: number, panY: number, scale: number,
  rotation = 0,
): PdfPoint {
  const cx = clientX - containerRect.left - containerRect.width / 2;
  const cy = clientY - containerRect.top - containerRect.height / 2;
  const xr = (cx - panX) / scale + pageWidth / 2;
  const yr = (cy - panY) / scale + pageHeight / 2;
  switch (((rotation % 360) + 360) % 360) {
    case 90: return { x: yr, y: pageWidth - xr };
    case 180: return { x: pageWidth - xr, y: pageHeight - yr };
    case 270: return { x: pageHeight - yr, y: xr };
    default: return { x: xr, y: yr };
  }
}

/** SVG transform mapping unrotated drawing coords into the rotated page frame. */
function rotationTransform(rotation: number, rotatedW: number, rotatedH: number): string | undefined {
  switch (((rotation % 360) + 360) % 360) {
    case 90: return `translate(${rotatedW} 0) rotate(90)`;
    case 180: return `translate(${rotatedW} ${rotatedH}) rotate(180)`;
    case 270: return `translate(0 ${rotatedH}) rotate(270)`;
    default: return undefined;
  }
}

export function DrawingOverlay({
  pageWidth, pageHeight, panX, panY, cssZoom, renderedScale, scale, rotation = 0,
  mode, onPointClick, children,
  runs = [], activeRunId, selectedRunId, onRunSelect, mousePosition, scalePxPerFt,
  onMouseMove, spaceHeld,
  items = [], selectedItemId, onItemSelect,
  onVertexContextMenu, onSegmentContextMenu, onItemContextMenu,
  movingVertex, movePreviewPos, snapNodeId, nodes = [],
  areas = [], activeAreaId, selectedAreaId, onAreaSelect, onAreaContextMenu,
  annotations = [], onAnnotationContextMenu, annotationPreview,
  multiSelected, marqueeRect,
  dragEnabled = false, onRunVertexDrag, onAreaVertexDrag, onItemDrag,
}: DrawingOverlayProps) {
  const isActive = mode !== 'none';
  const svgRef = useRef<SVGSVGElement>(null);

  // Keep viewport state in a ref so callbacks that need it don't cause
  // child re-renders when pan/zoom changes.
  const vpRef = useRef({ pageWidth, pageHeight, panX, panY, scale, rotation });
  vpRef.current = { pageWidth, pageHeight, panX, panY, scale, rotation };

  // Drag callbacks read through a ref so the window-level listeners attached
  // at mousedown never go stale across re-renders during the drag.
  const dragCbRef = useRef({ onRunVertexDrag, onAreaVertexDrag, onItemDrag });
  dragCbRef.current = { onRunVertexDrag, onAreaVertexDrag, onItemDrag };

  const beginDrag = useCallback((e: React.MouseEvent, target: DragTarget) => {
    if (!dragEnabled || e.button !== 0) return;
    const container = svgRef.current?.parentElement;
    if (!container) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    const dispatch = (clientX: number, clientY: number, commit: boolean) => {
      const rect = container.getBoundingClientRect();
      const vp = vpRef.current;
      const point = screenToPdf(clientX, clientY, rect, vp.pageWidth, vp.pageHeight, vp.panX, vp.panY, vp.scale, vp.rotation);
      const cbs = dragCbRef.current;
      if (target.kind === 'run') cbs.onRunVertexDrag?.(target.id, target.vertexIndex, point, commit);
      else if (target.kind === 'area') cbs.onAreaVertexDrag?.(target.id, target.vertexIndex, point, commit);
      else cbs.onItemDrag?.(target.id, point, commit);
    };

    const onMove = (ev: MouseEvent) => {
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      dispatch(ev.clientX, ev.clientY, false);
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // Below the threshold this was a click — leave it to the click handlers
      if (dragging) dispatch(ev.clientX, ev.clientY, true);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [dragEnabled]);

  const handleRunVertexMouseDown = useCallback((e: React.MouseEvent, runId: number, vertexIndex: number) => {
    beginDrag(e, { kind: 'run', id: runId, vertexIndex });
  }, [beginDrag]);

  const handleAreaVertexMouseDown = useCallback((e: React.MouseEvent, areaId: number, vertexIndex: number) => {
    beginDrag(e, { kind: 'area', id: areaId, vertexIndex });
  }, [beginDrag]);

  const handleItemMouseDown = useCallback((e: React.MouseEvent, itemId: number) => {
    beginDrag(e, { kind: 'item', id: itemId });
  }, [beginDrag]);

  const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (spaceHeld) return;
    if (!isActive) return;
    if (!onPointClick) return;
    const container = e.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const point = screenToPdf(e.clientX, e.clientY, rect, pageWidth, pageHeight, panX, panY, scale, rotation);
    onPointClick(point);
  }, [isActive, onPointClick, pageWidth, pageHeight, panX, panY, scale, rotation, spaceHeld]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!onMouseMove) return;
    const container = e.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    onMouseMove(screenToPdf(e.clientX, e.clientY, rect, pageWidth, pageHeight, panX, panY, scale, rotation));
  }, [onMouseMove, pageWidth, pageHeight, panX, panY, scale, rotation]);

  // Stable callback for segment right-click: reads viewport from ref so it
  // doesn't need pan/zoom as deps, keeping RunLines memo effective.
  const handleSegmentCtx = useCallback((runId: number, segmentIndex: number, screenX: number, screenY: number) => {
    if (!onSegmentContextMenu) return;
    const container = svgRef.current?.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const vp = vpRef.current;
    const point = screenToPdf(screenX, screenY, rect, vp.pageWidth, vp.pageHeight, vp.panX, vp.panY, vp.scale, vp.rotation);
    onSegmentContextMenu(runId, segmentIndex, screenX, screenY, point);
  }, [onSegmentContextMenu]);

  if (pageWidth === 0 || pageHeight === 0) return null;

  // Font size that stays ~11px visually regardless of zoom level.
  // Use renderedScale (not scale) so labelSize only recalculates after the
  // debounced PDF re-render, not on every wheel tick.  During a zoom gesture
  // labels CSS-scale slightly with cssZoom — imperceptible for ~300 ms.
  const labelSize = Math.max(6, pageWidth / 80) / (renderedScale > 0 ? renderedScale : 1);

  // Drawings are stored in the unrotated page frame; this group maps them
  // into the rotated frame the canvas was rendered in.
  const rotateGroup = rotationTransform(rotation, pageWidth, pageHeight);

  return (
    <svg
      ref={svgRef}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: pageWidth * renderedScale,
        height: pageHeight * renderedScale,
        transform: `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${cssZoom})`,
        transformOrigin: 'center center',
        pointerEvents: isActive && !spaceHeld ? 'all' : 'none',
        cursor: isActive && !spaceHeld ? 'crosshair' : 'default',
        overflow: 'visible',
      }}
    >
      <g transform={rotateGroup}>
      {/* Measured areas (rendered below runs so pipe lines stay clickable) */}
      {areas.map((area) => (
        <AreaPolygon
          key={area.id}
          area={area}
          isSelected={area.id === selectedAreaId || (multiSelected?.areas.has(area.id) ?? false)}
          isActive={area.id === activeAreaId}
          interactive={!isActive}
          labelSize={labelSize}
          scalePxPerFt={scalePxPerFt ?? 1}
          mousePosition={area.id === activeAreaId ? mousePosition : null}
          onSelect={onAreaSelect}
          onContextMenu={onAreaContextMenu}
          draggable={dragEnabled}
          onVertexMouseDown={handleAreaVertexMouseDown}
        />
      ))}
      {/* Completed + active runs */}
      {runs.map((run) => (
        <RunLines
          key={run.id}
          run={run}
          isSelected={run.id === selectedRunId || (multiSelected?.runs.has(run.id) ?? false)}
          isActive={run.id === activeRunId}
          interactive={!isActive}
          labelSize={labelSize}
          scalePxPerFt={scalePxPerFt ?? 1}
          mousePosition={run.id === activeRunId ? mousePosition : null}
          onSelect={onRunSelect}
          onVertexContextMenu={onVertexContextMenu}
          onSegmentContextMenu={handleSegmentCtx}
          renderedScale={renderedScale}
          movingVertexIndex={movingVertex?.runId === run.id ? movingVertex.vertexIndex : null}
          movePreviewPos={movingVertex?.runId === run.id ? movePreviewPos : null}
          draggable={dragEnabled}
          onVertexMouseDown={handleRunVertexMouseDown}
        />
      ))}
      <ItemSymbols
        items={items}
        selectedItemId={selectedItemId ?? null}
        multiSelectedIds={multiSelected?.items ?? null}
        labelSize={labelSize}
        onSelect={onItemSelect!}
        onContextMenu={onItemContextMenu}
        draggable={dragEnabled}
        onItemMouseDown={handleItemMouseDown}
      />
      {/* Plan annotations (rendered above takeoff geometry) */}
      <AnnotationLayer
        annotations={annotations}
        labelSize={labelSize}
        interactive={!isActive}
        selectedIds={multiSelected?.annotations}
        onContextMenu={onAnnotationContextMenu}
        preview={annotationPreview}
      />
      {/* Marquee selection rectangle */}
      {marqueeRect && (
        <rect
          x={marqueeRect.x} y={marqueeRect.y} width={marqueeRect.w} height={marqueeRect.h}
          fill="rgba(59,130,246,0.12)" stroke="var(--accent, #3b82f6)" strokeWidth={1.5}
          strokeDasharray="5 4" vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: 'none' }}
        />
      )}
      {/* Snap-to-node highlight during drawing */}
      {snapNodeId != null && (() => {
        const sn = nodes.find((n) => n.id === snapNodeId);
        if (!sn) return null;
        const r = labelSize * 0.6;
        return (
          <circle
            cx={sn.xPx} cy={sn.yPx} r={r}
            fill="none" stroke="var(--accent, #3b82f6)" strokeWidth={3}
            vectorEffect="non-scaling-stroke" opacity={0.7}
            style={{ pointerEvents: 'none' }}
          />
        );
      })()}
      {children}
      </g>
    </svg>
  );
}

/* ---- Per-area polygon rendering (memoized) ---- */

interface AreaPolygonProps {
  area: TakeoffArea;
  isSelected: boolean;
  isActive: boolean;
  /** False while any drawing/calibration is in progress so the polygon's
   *  fill region doesn't swallow point-placement clicks. */
  interactive: boolean;
  labelSize: number;
  scalePxPerFt: number;
  mousePosition?: PdfPoint | null;
  onSelect?: (id: number | null) => void;
  onContextMenu?: (areaId: number, screenX: number, screenY: number) => void;
  /** Vertices can be dragged when no tool is active */
  draggable?: boolean;
  onVertexMouseDown?: (e: React.MouseEvent, areaId: number, vertexIndex: number) => void;
}

const AreaPolygon = React.memo(function AreaPolygon({
  area, isSelected, isActive, interactive, labelSize, scalePxPerFt, mousePosition,
  onSelect, onContextMenu, draggable, onVertexMouseDown,
}: AreaPolygonProps) {
  const pts = area.points;
  if (pts.length === 0) return null;

  // While drawing, include the mouse position so fill and label preview live
  const previewPts = isActive && mousePosition ? [...pts, mousePosition] : pts;
  const pointsAttr = previewPts.map((p) => `${p.x},${p.y}`).join(' ');
  const strokeW = isSelected || isActive ? 3 : 2;
  const vertexR = labelSize * 0.25;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSelect && !isActive) onSelect(area.id);
  };

  const handleCtx = (e: React.MouseEvent) => {
    if (!onContextMenu || isActive) return;
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(area.id, e.clientX, e.clientY);
  };

  const areaSF = previewPts.length >= 3 ? computePolygonAreaSF(previewPts, scalePxPerFt) : 0;
  const centroid = previewPts.length >= 3 ? polygonCentroid(previewPts) : null;
  const sfLabel = `${Math.round(areaSF).toLocaleString()} SF`;
  const syLabel = `${squareFeetToYards(areaSF).toFixed(1)} SY`;
  const labelWidth = Math.max(sfLabel.length, syLabel.length) * labelSize * 0.55;

  return (
    <g style={{ pointerEvents: interactive && !isActive ? 'auto' : 'none' }}>
      <polygon
        points={pointsAttr}
        fill={area.color}
        fillOpacity={isSelected || isActive ? 0.3 : 0.18}
        stroke={area.color}
        strokeWidth={strokeW}
        strokeDasharray={isActive ? '6 4' : undefined}
        vectorEffect="non-scaling-stroke"
        style={{ cursor: isActive ? 'crosshair' : 'pointer' }}
        onClick={handleClick}
        onContextMenu={handleCtx}
      />
      {/* Closing edge hint while drawing */}
      {isActive && pts.length >= 2 && mousePosition && (
        <line
          x1={mousePosition.x} y1={mousePosition.y} x2={pts[0].x} y2={pts[0].y}
          stroke={area.color} strokeWidth={1.5} strokeDasharray="3 5" opacity={0.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {/* Vertices (slightly enlarged when draggable for an easier grab target) */}
      {pts.map((p, i) => (
        <circle
          key={`av-${i}`}
          cx={p.x} cy={p.y} r={draggable ? vertexR * 1.4 : vertexR}
          fill={area.color} stroke="#fff" strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          style={{ cursor: isActive ? 'crosshair' : draggable ? 'grab' : 'pointer' }}
          onClick={handleClick}
          onContextMenu={handleCtx}
          onMouseDown={draggable ? (e) => onVertexMouseDown?.(e, area.id, i) : undefined}
        />
      ))}
      {/* Centroid area label */}
      {centroid && areaSF > 0 && (
        <g transform={`translate(${centroid.x}, ${centroid.y})`} style={{ pointerEvents: 'none' }}
          opacity={isActive ? 0.85 : 1}>
          <rect
            x={-labelWidth / 2 - labelSize * 0.3}
            y={-labelSize * 1.35}
            width={labelWidth + labelSize * 0.6}
            height={labelSize * 2.7}
            fill="rgba(0,0,0,0.65)" rx={2}
          />
          <text x={0} y={-labelSize * 0.25} textAnchor="middle" fontSize={labelSize}
            fill="#fff" fontFamily="system-ui, sans-serif" fontWeight={600}
            style={{ userSelect: 'none' }}>
            {sfLabel}
          </text>
          <text x={0} y={labelSize * 0.95} textAnchor="middle" fontSize={labelSize * 0.85}
            fill="#ddd" fontFamily="system-ui, sans-serif"
            style={{ userSelect: 'none' }}>
            {syLabel}
          </text>
        </g>
      )}
      {/* Selection glow */}
      {isSelected && pts.length >= 3 && (
        <polygon
          points={pointsAttr}
          fill="none" stroke={area.color} strokeWidth={8} opacity={0.25}
          strokeLinejoin="round" vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: 'none' }}
        />
      )}
    </g>
  );
});

/* ---- Per-run SVG rendering (memoized) ---- */

interface RunLinesProps {
  run: TakeoffRun;
  isSelected: boolean;
  isActive: boolean;
  /** False while any drawing/calibration is in progress so completed runs
   *  don't swallow point-placement clicks. */
  interactive: boolean;
  labelSize: number;
  scalePxPerFt: number;
  mousePosition?: PdfPoint | null;
  onSelect?: (id: number | null) => void;
  onVertexContextMenu?: (runId: number, vertexIndex: number, screenX: number, screenY: number) => void;
  /** Simplified: no pdfPoint — DrawingOverlay computes it via vpRef. */
  onSegmentContextMenu?: (runId: number, segmentIndex: number, screenX: number, screenY: number) => void;
  /** Used by RunCalloutLabel for drag delta conversion. renderedScale is stable
   *  during zoom gestures, so it won't bust memo. */
  renderedScale: number;
  movingVertexIndex?: number | null;
  movePreviewPos?: PdfPoint | null;
  /** Vertices can be dragged when no tool is active */
  draggable?: boolean;
  onVertexMouseDown?: (e: React.MouseEvent, runId: number, vertexIndex: number) => void;
}

const RunLines = React.memo(function RunLines({
  run, isSelected, isActive, interactive, labelSize, scalePxPerFt, mousePosition,
  onSelect, onVertexContextMenu, onSegmentContextMenu,
  renderedScale, movingVertexIndex, movePreviewPos, draggable, onVertexMouseDown,
}: RunLinesProps) {
  const pts = run.points;
  const strokeW = isSelected || isActive ? 3 : 2;
  const nodeR = labelSize * 0.3;
  const opacity = isActive || isSelected ? 1 : 0.85;

  const handleRunClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onSelect && !isActive) onSelect(run.id);
  };

  const handleVertexCtx = (e: React.MouseEvent, vertexIndex: number) => {
    if (!onVertexContextMenu || isActive) return;
    e.preventDefault();
    e.stopPropagation();
    onVertexContextMenu(run.id, vertexIndex, e.clientX, e.clientY);
  };

  const handleSegmentCtx = (e: React.MouseEvent, segmentIndex: number) => {
    if (!onSegmentContextMenu || isActive) return;
    e.preventDefault();
    e.stopPropagation();
    onSegmentContextMenu(run.id, segmentIndex, e.clientX, e.clientY);
  };

  return (
    <g opacity={opacity} style={{ pointerEvents: interactive && !isActive ? 'auto' : 'none' }}>
      {/* Segments */}
      {pts.map((p, i) => {
        if (i === 0) return null;
        const prev = pts[i - 1];
        const segIdx = i - 1;
        return (
          <g key={`seg-${i}`}>
            <line
              x1={prev.x} y1={prev.y} x2={p.x} y2={p.y}
              stroke={run.color} strokeWidth={strokeW}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: isActive ? 'crosshair' : 'pointer' }}
              onClick={handleRunClick}
              onContextMenu={(e) => handleSegmentCtx(e, segIdx)}
            />
            {/* Hit area (wider invisible line for easier clicking) */}
            <line
              x1={prev.x} y1={prev.y} x2={p.x} y2={p.y}
              stroke="transparent" strokeWidth={8}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: isActive ? 'crosshair' : 'pointer' }}
              onClick={handleRunClick}
              onContextMenu={(e) => handleSegmentCtx(e, segIdx)}
            />
            <RunCalloutLabel
              p1={prev} p2={p} scalePxPerFt={scalePxPerFt}
              fontSize={labelSize} color={run.color}
              segmentIndex={segIdx} scale={renderedScale} isActive={isActive}
            />
          </g>
        );
      })}

      {/* Rubber band line (active run only) */}
      {isActive && pts.length > 0 && mousePosition && (
        <g>
          <line
            x1={pts[pts.length - 1].x} y1={pts[pts.length - 1].y}
            x2={mousePosition.x} y2={mousePosition.y}
            stroke={run.color} strokeWidth={1.5} strokeDasharray="6 4" opacity={0.6}
            vectorEffect="non-scaling-stroke"
          />
          <PreviewSegmentLabel
            p1={pts[pts.length - 1]} p2={mousePosition} scalePxPerFt={scalePxPerFt}
            fontSize={labelSize * 0.9} color={run.color} opacity={0.7}
          />
        </g>
      )}

      {/* Nodes */}
      {pts.map((p, i) => {
        const isNodeLinked = p.nodeId != null;
        const hasElev = p.invertElev != null || p.rimElev != null;
        const r = isNodeLinked ? nodeR * 1.6 : hasElev ? nodeR * 1.2 : nodeR;
        return (
          <React.Fragment key={`node-${i}`}>
            {/* Outer ring for node-linked or elevation vertices */}
            {(isNodeLinked || hasElev) && (
              <circle
                cx={p.x} cy={p.y} r={r + nodeR * 0.4}
                fill="none" stroke={isNodeLinked ? run.color : '#fff'}
                strokeWidth={isNodeLinked ? 2.5 : 2} opacity={isNodeLinked ? 0.6 : 0.5}
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'none' }}
              />
            )}
            <circle
              cx={p.x} cy={p.y} r={draggable ? r * 1.3 : r}
              fill={run.color} stroke="#fff"
              strokeWidth={isNodeLinked ? 2.5 : hasElev ? 2 : 1}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: isActive ? 'crosshair' : draggable ? 'grab' : 'pointer' }}
              onClick={handleRunClick}
              onContextMenu={(e) => handleVertexCtx(e, i)}
              onMouseDown={draggable ? (e) => onVertexMouseDown?.(e, run.id, i) : undefined}
            />
          </React.Fragment>
        );
      })}

      {/* Shoring depth warning */}
      {!isActive && pts.length >= 2 &&
        getMaxDepthFt(run, scalePxPerFt) > SHORING_DEPTH_THRESHOLD_FT && (
        <g transform={`translate(${pts[0].x}, ${pts[0].y})`} style={{ pointerEvents: 'none' }}>
          <polygon
            points={`0,${-labelSize * 1.4} ${labelSize * 0.7},0 ${-labelSize * 0.7},0`}
            fill="#f59e0b" stroke="#fff" strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <text x={0} y={-labelSize * 0.35} textAnchor="middle"
            fontSize={labelSize * 0.7} fill="#fff" fontWeight={700}
            style={{ userSelect: 'none' }}>!</text>
          <title>Depth exceeds 5 ft, so shoring may be required (OSHA 1926 Subpart P)</title>
        </g>
      )}

      {/* Selection glow */}
      {isSelected && pts.length > 1 && (
        <g opacity={0.25}>
          {pts.map((p, i) => {
            if (i === 0) return null;
            const prev = pts[i - 1];
            return (
              <line
                key={`glow-${i}`}
                x1={prev.x} y1={prev.y} x2={p.x} y2={p.y}
                stroke={run.color} strokeWidth={8}
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
              />
            );
          })}
        </g>
      )}

      {/* Move vertex preview */}
      {movingVertexIndex != null && movePreviewPos && (
        <g opacity={0.6} style={{ pointerEvents: 'none' }}>
          {/* Ghost lines to adjacent vertices */}
          {movingVertexIndex > 0 && (
            <line
              x1={pts[movingVertexIndex - 1].x} y1={pts[movingVertexIndex - 1].y}
              x2={movePreviewPos.x} y2={movePreviewPos.y}
              stroke={run.color} strokeWidth={2} strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {movingVertexIndex < pts.length - 1 && (
            <line
              x1={movePreviewPos.x} y1={movePreviewPos.y}
              x2={pts[movingVertexIndex + 1].x} y2={pts[movingVertexIndex + 1].y}
              stroke={run.color} strokeWidth={2} strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {/* Ghost vertex */}
          <circle
            cx={movePreviewPos.x} cy={movePreviewPos.y} r={nodeR * 1.4}
            fill={run.color} stroke="#fff" strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          {/* Highlight the original vertex */}
          <circle
            cx={pts[movingVertexIndex].x} cy={pts[movingVertexIndex].y} r={nodeR * 1.8}
            fill="none" stroke="#fff" strokeWidth={2} strokeDasharray="4 3" opacity={0.5}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
    </g>
  );
});

/* ---- Preview label for rubber-band line during drawing ---- */

function PreviewSegmentLabel({ p1, p2, scalePxPerFt, fontSize, color, opacity = 1 }: {
  p1: PdfPoint; p2: PdfPoint; scalePxPerFt: number;
  fontSize: number; color: string; opacity?: number;
}) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const distPx = Math.sqrt(dx * dx + dy * dy);
  if (distPx < 1) return null;
  const distFt = distPx / scalePxPerFt;
  const label = `${distFt.toFixed(1)}'`;

  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;

  // Angle in degrees; keep text readable (no upside-down)
  let angle = Math.atan2(dy, dx) * (180 / Math.PI);
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;

  const pad = fontSize * 0.25;
  const textW = label.length * fontSize * 0.55;

  return (
    <g transform={`translate(${mx}, ${my}) rotate(${angle})`} opacity={opacity} style={{ pointerEvents: 'none' }}>
      <rect
        x={-textW / 2 - pad} y={-fontSize / 2 - pad}
        width={textW + pad * 2} height={fontSize + pad * 2}
        fill="rgba(0,0,0,0.65)" rx={2}
      />
      <text
        x={0} y={fontSize * 0.35}
        textAnchor="middle"
        fontSize={fontSize}
        fill="#fff"
        fontFamily="system-ui, sans-serif"
        fontWeight={500}
        style={{ userSelect: 'none' }}
      >
        {label}
      </text>
    </g>
  );
}

export { screenToPdf };
