import React from 'react';

// In-app confirm dialog — replaces native confirm() which steals
// focus from Electron's renderer and leaves inputs unresponsive.
export function ConfirmDialog({ message, onYes, onNo, yesLabel = 'Delete' }: {
  message: string;
  onYes: () => void;
  onNo: () => void;
  yesLabel?: string;
}) {
  return (
    <div className="modal-overlay" onClick={onNo} style={{ zIndex: 10000 }}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 400 }}>
        <h3>Confirm</h3>
        <p style={{ margin: '16px 0 24px', lineHeight: 1.5 }}>{message}</p>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onNo} autoFocus>Cancel</button>
          <button className="btn btn-primary" onClick={onYes}
            style={{ background: 'var(--danger, #ef4444)' }}>{yesLabel}</button>
        </div>
      </div>
    </div>
  );
}
