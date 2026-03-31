import React from 'react';

// In-app confirm dialog — replaces native confirm() which steals
// focus from Electron's renderer and leaves inputs unresponsive.
export function ConfirmDialog({ message, onYes, onNo, yesLabel = 'Delete', variant = 'danger' }: {
  message: string;
  onYes: () => void;
  onNo: () => void;
  yesLabel?: string;
  variant?: 'danger' | 'neutral';
}) {
  const yesStyle = variant === 'danger'
    ? { background: 'var(--danger, #ef4444)' }
    : {};

  return (
    <div className="modal-backdrop" onClick={onNo} style={{ zIndex: 10000 }}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ width: 400 }}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>Confirm</h3>
        </div>
        <div className="modal-body">
          <p style={{ lineHeight: 1.5 }}>{message}</p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onNo} autoFocus>Cancel</button>
          <button className="btn btn-primary" onClick={onYes} style={yesStyle}>{yesLabel}</button>
        </div>
      </div>
    </div>
  );
}
