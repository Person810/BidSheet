import React, { useEffect, useState } from 'react';
import { dismissOnEscOnly } from './modalDismiss';

interface ShortcutRow {
  keys: string[];
  action: string;
}

const GENERAL_SHORTCUTS: ShortcutRow[] = [
  { keys: ['?'], action: 'Show / hide this overlay' },
  { keys: ['Esc'], action: 'Close dialogs and menus' },
];

const TAKEOFF_SHORTCUTS: ShortcutRow[] = [
  { keys: ['Ctrl', 'Z'], action: 'Undo (removes last point while drawing)' },
  { keys: ['Ctrl', 'Y'], action: 'Redo' },
  { keys: ['Esc'], action: 'Finish drawing / cancel tool' },
  { keys: ['Shift'], action: 'Hold for straight (ortho) lines while drawing or dragging' },
  { keys: ['Space'], action: 'Hold to pan' },
  { keys: ['←', '→'], action: 'Previous / next page' },
  { keys: ['+', '−'], action: 'Zoom in / out' },
  { keys: ['Ctrl', '0'], action: 'Fit page to width' },
  { keys: ['Right-click'], action: 'Context menu on runs, vertices, items, areas' },
  { keys: ['Drag'], action: 'Move vertices and count items directly' },
];

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="shortcut-keys">
      {keys.map((k, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="shortcut-plus">+</span>}
          <kbd>{k}</kbd>
        </React.Fragment>
      ))}
    </span>
  );
}

/**
 * App-wide keyboard shortcut reference, toggled with `?`.
 * Mounted once in App so it works from any page.
 */
export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '?') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={dismissOnEscOnly(() => setOpen(false))}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}
        role="dialog" aria-label="Keyboard shortcuts">
        <h3>Keyboard Shortcuts</h3>

        <h4 className="shortcut-section">General</h4>
        <table className="shortcut-table">
          <tbody>
            {GENERAL_SHORTCUTS.map((s, i) => (
              <tr key={i}>
                <td><Keys keys={s.keys} /></td>
                <td>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4 className="shortcut-section">Plan Takeoff</h4>
        <table className="shortcut-table">
          <tbody>
            {TAKEOFF_SHORTCUTS.map((s, i) => (
              <tr key={i}>
                <td><Keys keys={s.keys} /></td>
                <td>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}
