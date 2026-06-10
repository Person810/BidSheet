import React from 'react';
import type { TakeoffAnnotation, AnnotationKind, PdfPoint } from './types';
import { ANNOTATION_COLOR } from './types';

/** Scalloped revision-cloud path around a rectangle (clockwise, bumps outward). */
function cloudPath(x: number, y: number, w: number, h: number): string {
  const r = Math.max(6, Math.min(Math.min(w, h) / 4, Math.max(w, h) / 12, 18));
  const seg = r * 1.6;
  const parts: string[] = [`M ${x} ${y}`];
  const arcsAlong = (fromX: number, fromY: number, toX: number, toY: number) => {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const len = Math.sqrt(dx * dx + dy * dy);
    const n = Math.max(1, Math.round(len / seg));
    for (let i = 1; i <= n; i++) {
      const px = fromX + (dx * i) / n;
      const py = fromY + (dy * i) / n;
      parts.push(`A ${r} ${r} 0 0 1 ${px} ${py}`);
    }
  };
  arcsAlong(x, y, x + w, y);
  arcsAlong(x + w, y, x + w, y + h);
  arcsAlong(x + w, y + h, x, y + h);
  arcsAlong(x, y + h, x, y);
  parts.push('Z');
  return parts.join(' ');
}

function arrowHead(x1: number, y1: number, x2: number, y2: number, size: number): string {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const a1 = angle + Math.PI - 0.45;
  const a2 = angle + Math.PI + 0.45;
  return `${x2},${y2} ${x2 + size * Math.cos(a1)},${y2 + size * Math.sin(a1)} ${x2 + size * Math.cos(a2)},${y2 + size * Math.sin(a2)}`;
}

function Annotation({ ann, labelSize, interactive, isSelected, onContextMenu }: {
  ann: TakeoffAnnotation;
  labelSize: number;
  interactive: boolean;
  isSelected: boolean;
  onContextMenu?: (id: number, screenX: number, screenY: number) => void;
}) {
  const handleCtx = (e: React.MouseEvent) => {
    if (!onContextMenu) return;
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(ann.id, e.clientX, e.clientY);
  };

  const events: Pick<React.SVGProps<SVGElement>, never> = {};
  const groupStyle: React.CSSProperties = { pointerEvents: interactive ? 'auto' : 'none' };
  const stroke = isSelected ? 3 : 2;

  if (ann.kind === 'text') {
    const fontSize = labelSize;
    const linesArr = ann.text.split('\n');
    const widest = Math.max(...linesArr.map((l) => l.length), 1);
    const boxW = widest * fontSize * 0.58 + fontSize;
    const boxH = linesArr.length * fontSize * 1.3 + fontSize * 0.6;
    return (
      <g style={groupStyle} onContextMenu={handleCtx} {...events}>
        <rect x={ann.x1} y={ann.y1} width={boxW} height={boxH}
          fill="rgba(255,255,255,0.92)" stroke={ann.color} strokeWidth={stroke}
          vectorEffect="non-scaling-stroke" rx={2}
          style={{ cursor: 'context-menu' }} />
        {linesArr.map((line, i) => (
          <text key={i} x={ann.x1 + fontSize * 0.5} y={ann.y1 + fontSize * 1.1 + i * fontSize * 1.3}
            fontSize={fontSize} fill={ann.color} fontFamily="system-ui, sans-serif" fontWeight={600}
            style={{ userSelect: 'none', pointerEvents: 'none' }}>
            {line}
          </text>
        ))}
      </g>
    );
  }

  if (ann.kind === 'arrow' && ann.x2 != null && ann.y2 != null) {
    return (
      <g style={groupStyle} onContextMenu={handleCtx}>
        <line x1={ann.x1} y1={ann.y1} x2={ann.x2} y2={ann.y2}
          stroke={ann.color} strokeWidth={stroke} vectorEffect="non-scaling-stroke" />
        <polygon points={arrowHead(ann.x1, ann.y1, ann.x2, ann.y2, labelSize * 0.9)}
          fill={ann.color} />
        {/* Wider invisible hit line for right-click */}
        <line x1={ann.x1} y1={ann.y1} x2={ann.x2} y2={ann.y2}
          stroke="transparent" strokeWidth={10} vectorEffect="non-scaling-stroke"
          style={{ cursor: 'context-menu' }} />
      </g>
    );
  }

  if (ann.kind === 'cloud' && ann.x2 != null && ann.y2 != null) {
    const x = Math.min(ann.x1, ann.x2);
    const y = Math.min(ann.y1, ann.y2);
    const w = Math.abs(ann.x2 - ann.x1);
    const h = Math.abs(ann.y2 - ann.y1);
    if (w < 1 || h < 1) return null;
    return (
      <g style={groupStyle} onContextMenu={handleCtx}>
        <path d={cloudPath(x, y, w, h)} fill="none" stroke={ann.color}
          strokeWidth={stroke} vectorEffect="non-scaling-stroke"
          style={{ cursor: 'context-menu' }} />
      </g>
    );
  }

  return null;
}

interface AnnotationLayerProps {
  annotations: TakeoffAnnotation[];
  labelSize: number;
  /** False while any drawing/calibration is in progress */
  interactive: boolean;
  selectedIds?: Set<number>;
  onContextMenu?: (id: number, screenX: number, screenY: number) => void;
  /** In-progress two-point annotation preview */
  preview?: { kind: AnnotationKind; start: PdfPoint; mouse: PdfPoint } | null;
}

export default function AnnotationLayer({
  annotations, labelSize, interactive, selectedIds, onContextMenu, preview,
}: AnnotationLayerProps) {
  return (
    <g>
      {annotations.map((ann) => (
        <Annotation key={ann.id} ann={ann} labelSize={labelSize}
          interactive={interactive}
          isSelected={selectedIds?.has(ann.id) ?? false}
          onContextMenu={onContextMenu} />
      ))}
      {preview && preview.kind === 'arrow' && (
        <g opacity={0.7} style={{ pointerEvents: 'none' }}>
          <line x1={preview.start.x} y1={preview.start.y} x2={preview.mouse.x} y2={preview.mouse.y}
            stroke={ANNOTATION_COLOR} strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
          <polygon points={arrowHead(preview.start.x, preview.start.y, preview.mouse.x, preview.mouse.y, labelSize * 0.9)}
            fill={ANNOTATION_COLOR} />
        </g>
      )}
      {preview && preview.kind === 'cloud' && (() => {
        const x = Math.min(preview.start.x, preview.mouse.x);
        const y = Math.min(preview.start.y, preview.mouse.y);
        const w = Math.abs(preview.mouse.x - preview.start.x);
        const h = Math.abs(preview.mouse.y - preview.start.y);
        if (w < 1 || h < 1) return null;
        return (
          <path d={cloudPath(x, y, w, h)} fill="none" stroke={ANNOTATION_COLOR}
            strokeWidth={2} strokeDasharray="6 4" opacity={0.7}
            vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />
        );
      })()}
    </g>
  );
}
