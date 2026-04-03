import React, { useCallback, useRef } from 'react';
import type { PdfPoint, OverlayMode, TakeoffRun, TakeoffItem } from './types';
import ItemSymbols from './ItemSymbols';
import RunCalloutLabel from './RunCalloutLabel';
import { getMaxDepthFt, SHORING_DEPTH_THRESHOLD_FT } from './takeoffUtils';

interface DrawingOverlayProps {
  pageWidth: number;
  pageHeight: number;
  panX: number;
  panY: number;
  cssZoom: number;
  renderedScale: number;
  scale: number;
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
}

function screenToPdf(
  clientX: number, clientY: number, containerRect: DOMRect,
  pageWidth: number, pageHeight: number, panX: number, panY: number, scale: number,
): PdfPoint {
  const cx = clientX - containerRect.left - containerRect.width / 2;
  const cy = clientY - containerRect.top - containerRect.height / 2;
  const pdfX = (cx - panX) / scale + pageWidth / 2;
  const pdfY = (cy - panY) / scale + pageHeight / 2;
  return { x: pdfX, y: pdfY };
}

export function DrawingOverlay({
  pageWidth, pageHeight, panX, panY, cssZoom, renderedScale, scale,
  mode, onPointClick, children,
  runs = [], activeRunId, selectedRunId, onRunSelect, mousePosition, scalePxPerFt,
  onMouseMove, spaceHeld,
  items = [], selectedItemId, onItemSelect,
  onVertexContextMenu, onSegmentContextMenu, onItemContextMenu,
  movingVertex, movePreviewPos, snapNodeId, nodes = [],
}: DrawingOverlayProps) {
  const isActive = mode !== 'none';
  const svgRef = useRef<SVGSVGElement>(null);

  // Keep viewport state in a ref so callbacks that need it don't cause
  // child re-renders when pan/zoom changes.
  const vpRef = useRef({ pageWidth, pageHeight, panX, panY, scale });
  vpRef.current = { pageWidth, pageHeight, panX, panY, scale };

  const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (spaceHeld) return;
    if (!isActive) return;
    if (!onPointClick) return;
    const container = e.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const point = screenToPdf(e.clientX, e.clientY, rect, pageWidth, pageHeight, panX, panY, scale);
    onPointClick(point);
  }, [isActive, onPointClick, pageWidth, pageHeight, panX, panY, scale, spaceHeld]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!onMouseMove) return;
    const container = e.currentTarget.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    onMouseMove(screenToPdf(e.clientX, e.clientY, rect, pageWidth, pageHeight, panX, panY, scale));
  }, [onMouseMove, pageWidth, pageHeight, panX, panY, scale]);

  // Stable callback for segment right-click: reads viewport from ref so it
  // doesn't need pan/zoom as deps, keeping RunLines memo effective.
  const handleSegmentCtx = useCallback((runId: number, segmentIndex: number, screenX: number, screenY: number) => {
    if (!onSegmentContextMenu) return;
    const container = svgRef.current?.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const vp = vpRef.current;
    const point = screenToPdf(screenX, screenY, rect, vp.pageWidth, vp.pageHeight, vp.panX, vp.panY, vp.scale);
    onSegmentContextMenu(runId, segmentIndex, screenX, screenY, point);
  }, [onSegmentContextMenu]);

  if (pageWidth === 0 || pageHeight === 0) return null;

  // Font size that stays ~11px visually regardless of zoom level.
  // Use renderedScale (not scale) so labelSize only recalculates after the
  // debounced PDF re-render, not on every wheel tick.  During a zoom gesture
  // labels CSS-scale slightly with cssZoom — imperceptible for ~300 ms.
  const labelSize = Math.max(6, pageWidth / 80) / (renderedScale > 0 ? renderedScale : 1);

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
      {/* Completed + active runs */}
      {runs.map((run) => (
        <RunLines
          key={run.id}
          run={run}
          isSelected={run.id === selectedRunId}
          isActive={run.id === activeRunId}
          labelSize={labelSize}
          scalePxPerFt={scalePxPerFt ?? 1}
          mousePosition={run.id === activeRunId ? mousePosition : null}
          onSelect={onRunSelect}
          onVertexContextMenu={onVertexContextMenu}
          onSegmentContextMenu={handleSegmentCtx}
          renderedScale={renderedScale}
          movingVertexIndex={movingVertex?.runId === run.id ? movingVertex.vertexIndex : null}
          movePreviewPos={movingVertex?.runId === run.id ? movePreviewPos : null}
        />
      ))}
      <ItemSymbols
        items={items}
        selectedItemId={selectedItemId ?? null}
        labelSize={labelSize}
        onSelect={onItemSelect!}
        onContextMenu={onItemContextMenu}
      />
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
    </svg>
  );
}

/* ---- Per-run SVG rendering (memoized) ---- */

interface RunLinesProps {
  run: TakeoffRun;
  isSelected: boolean;
  isActive: boolean;
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
}

const RunLines = React.memo(function RunLines({
  run, isSelected, isActive, labelSize, scalePxPerFt, mousePosition,
  onSelect, onVertexContextMenu, onSegmentContextMenu,
  renderedScale, movingVertexIndex, movePreviewPos,
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
    <g opacity={opacity} style={{ pointerEvents: isActive ? 'none' : 'auto' }}>
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
              cx={p.x} cy={p.y} r={r}
              fill={run.color} stroke="#fff"
              strokeWidth={isNodeLinked ? 2.5 : hasElev ? 2 : 1}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: isActive ? 'crosshair' : 'pointer' }}
              onClick={handleRunClick}
              onContextMenu={(e) => handleVertexCtx(e, i)}
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
          <title>Depth exceeds 5 ft — shoring may be required (OSHA 1926 Subpart P)</title>
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
