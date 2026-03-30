import React from 'react';
import type { TakeoffItem, PdfPoint } from './types';
import type { PlacingMaterial } from './useItemManager';

const ITEM_COLOR = '#e91e63';
const ITEM_GLOW = 'rgba(233,30,99,0.3)';

interface ItemSymbolsProps {
  items: TakeoffItem[];
  selectedItemId: number | null;
  labelSize: number;
  onSelect: (id: number | null) => void;
  ghostPosition: PdfPoint | null;
  placingMaterial: PlacingMaterial | null;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '\u2026' : s;
}

export default function ItemSymbols({
  items, selectedItemId, labelSize, onSelect, ghostPosition, placingMaterial,
}: ItemSymbolsProps) {
  const r = Math.max(labelSize * 0.45, 4);

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

      {/* Ghost diamond at cursor during placement */}
      {ghostPosition && placingMaterial && (
        <g opacity={0.5}>
          <rect
            x={ghostPosition.x - r} y={ghostPosition.y - r}
            width={r * 2} height={r * 2}
            transform={`rotate(45 ${ghostPosition.x} ${ghostPosition.y})`}
            fill={ITEM_COLOR} stroke="#fff" strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
          <text
            x={ghostPosition.x} y={ghostPosition.y + r + labelSize * 0.9}
            textAnchor="middle" fontSize={labelSize * 0.6}
            fill="var(--text-primary, #333)" pointerEvents="none"
          >
            {truncate(placingMaterial.name, 15)}
          </text>
        </g>
      )}
    </g>
  );
}
