import React from 'react';

function Separator() {
  return <div style={{ width: 1, height: 20, background: 'var(--border-color, #ddd)', margin: '0 4px' }} />;
}

interface TakeoffToolbarProps {
  // Navigation
  onBack: () => void;
  // PDF
  onLoadPlan: () => void;
  loading: boolean;
  // Pages
  pageNum: number;
  totalPages: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  // Zoom
  zoomPercent: number;
  onFitToWidth: () => void;
  // Calibration
  calibrating: boolean;
  onToggleCalibrate: () => void;
  canCalibrate: boolean;
  scaleDisplay: string | null;
  // Runs
  canAddRun: boolean;
  onAddRun: () => void;
  isDrawing: boolean;
  // File info
  pdfFilename: string;
}

export default function TakeoffToolbar(props: TakeoffToolbarProps) {
  const {
    onBack,
    onLoadPlan, loading,
    pageNum, totalPages, onPrevPage, onNextPage,
    zoomPercent, onFitToWidth,
    calibrating, onToggleCalibrate, canCalibrate, scaleDisplay,
    canAddRun, onAddRun, isDrawing,
    pdfFilename,
  } = props;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
      borderBottom: '1px solid var(--border-color, #e0e0e0)',
      background: 'var(--bg-primary, #fff)', flexShrink: 0,
    }}>
      <button className="btn btn-secondary btn-sm" onClick={onBack}>
        &#8592; Back to Job
      </button>
      <Separator />

      <button className="btn btn-secondary btn-sm" onClick={onLoadPlan} disabled={loading}>
        Load Plan
      </button>
      <Separator />

      <button className="btn btn-secondary btn-sm" onClick={onPrevPage}
        disabled={pageNum <= 1} title="Previous page">&larr;</button>
      <span style={{ fontSize: 13, minWidth: 80, textAlign: 'center', whiteSpace: 'nowrap' }}>
        Page {pageNum} of {totalPages || '...'}
      </span>
      <button className="btn btn-secondary btn-sm" onClick={onNextPage}
        disabled={pageNum >= totalPages} title="Next page">&rarr;</button>
      <Separator />

      <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 48, textAlign: 'center' }}>
        {zoomPercent}%
      </span>
      <button className="btn btn-secondary btn-sm" onClick={onFitToWidth} title="Fit to width">
        Fit
      </button>
      <Separator />

      <button
        className={`btn btn-sm ${calibrating ? 'btn-primary' : 'btn-secondary'}`}
        onClick={onToggleCalibrate}
        disabled={!canCalibrate}
        title="Calibrate the plan scale"
      >
        Set Scale
      </button>
      {scaleDisplay && !calibrating && (
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {scaleDisplay}
        </span>
      )}
      <Separator />

      <button
        className="btn btn-primary btn-sm"
        onClick={onAddRun}
        disabled={!canAddRun}
        title={!canAddRun ? 'Calibrate scale first' : 'Add a pipe run'}
      >
        Add Run
      </button>

      {isDrawing && (
        <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500 }}>
          Drawing &mdash; click to place, right-click to undo, Esc to finish
        </span>
      )}

      <div style={{ flex: 1 }} />

      <span className="text-muted" style={{ fontSize: 11, maxWidth: 300, overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl' }}>
        {pdfFilename}
      </span>
    </div>
  );
}
