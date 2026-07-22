import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CalcBreakdown } from '../../shared/calcExplain';

/**
 * "Show the math" affordance (§5). A quiet ƒₓ trigger that opens a small
 * popover spelling out a calculation's inputs and arithmetic. The panel is
 * portaled to <body> and fixed-positioned from the trigger's rect so it never
 * gets clipped inside the scrollable grid or a modal.
 */
export function CalcPopover({ breakdown, ariaLabel = 'Show the math' }: {
  breakdown: CalcBreakdown;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const width = 300;
    // Prefer below-right of the trigger; clamp into the viewport.
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    setPos({ top: r.bottom + 4, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // The panel is fixed-positioned from a rect captured at open, so scrolling
    // (or resizing) detaches it from its trigger — close instead of tracking,
    // matching the outside-click dismiss. Capture phase catches scrolls inside
    // nested containers (the grid, modals), not just the window.
    const onScroll = (e: Event) => {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`calc-trigger no-print ${open ? 'calc-trigger-open' : ''}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        title={ariaLabel}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        ƒ<span className="calc-trigger-x">x</span>
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          className="calc-popover"
          role="dialog"
          aria-label={breakdown.formula}
          style={{ top: pos.top, left: pos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="calc-popover-formula">{breakdown.formula}</div>
          <table className="calc-popover-table">
            <tbody>
              {breakdown.lines.map((ln, i) => (
                <tr key={i} className={ln.kind === 'result' ? 'calc-line-result' : undefined}>
                  <td className="calc-line-label">{ln.label}</td>
                  <td className="calc-line-value">{ln.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {breakdown.note && <div className="calc-popover-note">{breakdown.note}</div>}
        </div>,
        document.body,
      )}
    </>
  );
}
