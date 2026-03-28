/**
 * Toast notification overlay.
 *
 * Mount once in App.tsx:
 *   <ToastContainer />
 *
 * Renders in bottom-right corner. Toasts stack upward, auto-dismiss,
 * and can be closed manually with the X button.
 */

import React from 'react';
import { useToastStore, type ToastType } from '../stores/toast-store';

const COLORS: Record<ToastType, { bg: string; border: string; text: string }> = {
  error:   { bg: '#2d1b1b', border: '#c0392b', text: '#e74c3c' },
  warn:    { bg: '#2d2a1b', border: '#d4a017', text: '#f0c040' },
  success: { bg: '#1b2d1e', border: '#27ae60', text: '#2ecc71' },
  info:    { bg: '#1b222d', border: '#2980b9', text: '#5dade2' },
};

const ICONS: Record<ToastType, string> = {
  error: '\u2716',   // heavy X
  warn: '\u26A0',    // warning triangle
  success: '\u2714', // check
  info: '\u2139',    // info circle
};

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column-reverse',
      gap: 8,
      maxWidth: 420,
      pointerEvents: 'none',
    }}>
      {toasts.map((toast) => {
        const colors = COLORS[toast.type];
        return (
          <div
            key={toast.id}
            style={{
              background: colors.bg,
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              pointerEvents: 'auto',
              animation: 'toast-slide-in 0.25s ease-out',
            }}
          >
            <span style={{ color: colors.text, fontSize: 16, lineHeight: '20px', flexShrink: 0 }}>
              {ICONS[toast.type]}
            </span>
            <span style={{ color: '#ddd', fontSize: 13, lineHeight: '20px', flex: 1 }}>
              {toast.message}
            </span>
            <button
              onClick={() => removeToast(toast.id)}
              style={{
                background: 'none',
                border: 'none',
                color: '#888',
                cursor: 'pointer',
                fontSize: 14,
                padding: '0 2px',
                lineHeight: '20px',
                flexShrink: 0,
              }}
              title="Dismiss"
            >
              \u2715
            </button>
          </div>
        );
      })}
    </div>
  );
}
