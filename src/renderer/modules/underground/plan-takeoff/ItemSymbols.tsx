import React from 'react';
import type { TakeoffItem } from './types';

const ITEM_COLOR = '#e91e63';
const ITEM_GLOW = 'rgba(233,30,99,0.3)';

interface ItemSymbolsProps {
  items: TakeoffItem[];
  selectedItemId: number | null;
  labelSize: number;
  onSelect: (id: number | null) => void;
  onContextMenu?: (itemId: number, screenX: number, screenY: number) => void;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

export default function ItemSymbols({
  items, selectedItemId, labelSize, onSelect, onContextMenu,
}: ItemSymbolsProps) {
  const r = labelSize * 0.45;

  return (
    <g>
      {items.map((item) => {
        const isSelected = item.id === selectedItemId;
        return (
          <g key={item.id}>
            {/* Selection glow */}
            {isSelected && (
              <rect
                x={item.xPx - r * 1.6} y={item.yPx - r * 1.6}
                width={r * 3.2} height={r * 3.2}
                transform={`rotate(45 ${item.xPx} ${item.yPx})`}
                fill="none" stroke={ITEM_GLOW} strokeWidth={4}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {/* Diamond shape (rotated square) */}
            <rect
              x={item.xPx - r} y={item.yPx - r}
              width={r * 2} height={r * 2}
              transform={`rotate(45 ${item.xPx} ${item.yPx})`}
              fill={ITEM_COLOR} stroke="#fff" strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: 'pointer', pointerEvents: 'auto' }}
              onClick={(e) => { e.stopPropagation(); onSelect(item.id); }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onContextMenu?.(item.id, e.clientX, e.clientY);
              }}
            />
            {/* Material name label */}
            <text
              x={item.xPx} y={item.yPx + r + labelSize * 0.9}
              textAnchor="middle" fontSize={labelSize * 0.6}
              fill="var(--text-primary, #333)" pointerEvents="none"
            >
              {truncate(item.materialName, 15)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
