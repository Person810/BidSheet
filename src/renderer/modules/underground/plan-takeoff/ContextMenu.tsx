import React, { useEffect, useRef, useLayoutEffect, useState } from 'react';

export type ContextTargetType = 'vertex' | 'segment' | 'fitting' | 'countItem' | 'canvas';

export interface ContextMenuItem {
  label: string;
  action: string;
  shortcutHint?: string;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onAction: (action: string) => void;
  onClose: () => void;
}

export function getMenuItems(targetType: ContextTargetType): ContextMenuItem[] {
  switch (targetType) {
    case 'vertex':
      return [
        { label: 'Edit Vertex', action: 'editVertex' },
        { label: 'Move Vertex', action: 'moveVertex' },
        { label: 'Delete Vertex', action: 'deleteVertex' },
        { label: 'Insert Fitting', action: 'insertFitting' },
        { label: 'Start New Run From Here', action: 'startRunFromHere' },
      ];
    case 'segment':
      return [
        { label: 'Add Vertex Here', action: 'addVertexHere' },
        { label: 'Insert Fitting Here', action: 'insertFittingHere' },
        { label: 'Delete Run', action: 'deleteRun' },
      ];
    case 'fitting':
      return [
        { label: 'Edit Fitting', action: 'editFitting' },
        { label: 'Remove Fitting', action: 'removeFitting' },
        { label: 'Start New Run From Here', action: 'startRunFromHere' },
      ];
    case 'countItem':
      return [
        { label: 'Edit Item', action: 'editItem' },
        { label: 'Remove Item', action: 'removeItem' },
        { label: 'Duplicate Item', action: 'duplicateItem' },
      ];
    case 'canvas':
      return [
        { label: 'Start New Run', action: 'startNewRun' },
        { label: 'Add Count Item', action: 'addCountItem' },
      ];
  }
}

export function ContextMenu({ x, y, items, onAction, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Flip position if menu overflows viewport
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let adjustedX = x;
    let adjustedY = y;
    if (x + rect.width > window.innerWidth - 8) adjustedX = x - rect.width;
    if (y + rect.height > window.innerHeight - 8) adjustedY = y - rect.height;
    if (adjustedX < 4) adjustedX = 4;
    if (adjustedY < 4) adjustedY = 4;
    if (adjustedX !== pos.x || adjustedY !== pos.y) setPos({ x: adjustedX, y: adjustedY });
  }, [x, y]);

  // Dismiss on click outside, escape, scroll
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleScroll = () => onClose();

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleScroll, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleScroll);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 800,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '4px 0',
        minWidth: 180,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      }}
    >
      {items.map((item) => (
        <div
          key={item.action}
          onClick={() => { onAction(item.action); onClose(); }}
          style={{
            padding: '7px 14px',
            fontSize: 12,
            color: 'var(--text-primary)',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span>{item.label}</span>
          {item.shortcutHint && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 16 }}>
              {item.shortcutHint}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
