import React from 'react';

function Separator() {
  return <div style={{ width: 1, height: 20, background: 'var(--border-color, #ddd)', margin: '0 4px' }} />;
}

interface TakeoffToolbarProps {
  // Job
  jobs: any[];
  selectedJobId: number | null;
  onJobChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
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
  // Items
  canPlaceItem: boolean;
  onPlaceItem: () => void;
  isPlacing: boolean;
  placingMaterialName: string | null;
  onDonePlacing: () => void;
  // File info
  pdfFilename: string;
}

export default function TakeoffToolbar(props: TakeoffToolbarProps) {
  const {
    jobs, selectedJobId, onJobChange,
    onLoadPlan, loading,
    pageNum, totalPages, onPrevPage, onNextPage,
    zoomPercent, onFitToWidth,
    calibrating, onToggleCalibrate, canCalibrate, scaleDisplay,
    canAddRun, onAddRun, isDrawing,
    canPlaceItem, onPlaceItem, isPlacing, placingMaterialName, onDonePlacing,
    pdfFilename,
  } = props;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
      borderBottom: '1px solid var(--border-color, #e0e0e0)',
      background: 'var(--bg-primary, #fff)', flexShrink: 0,
    }}>
      <select
        className="form-control"
        style={{ width: 200, fontSize: 13, padding: '4px 8px' }}
        value={selectedJobId ?? ''}
        onChange={onJobChange}
      >
        <option value="">-- Select Job --</option>
        {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
      </select>
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
        title={!canCalibrate ? 'Select a job first' : 'Calibrate the plan scale'}
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

      {!isDrawing && !isPlacing && (
        <>
          <Separator />
          <button
            className="btn btn-primary btn-sm"
            onClick={onPlaceItem}
            disabled={!canPlaceItem}
            title={!canPlaceItem ? 'Calibrate scale first' : 'Place a count item'}
          >
            Place Item
          </button>
        </>
      )}

      {isPlacing && placingMaterialName && (
        <>
          <Separator />
          <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500 }}>
            Placing: {placingMaterialName}
          </span>
          <button className="btn btn-secondary btn-sm" onClick={onDonePlacing}
            style={{ marginLeft: 4, fontSize: 11 }}>
            Done
          </button>
          <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginLeft: 4 }}>
            Click to place &middot; Esc to finish
          </span>
        </>
      )}

      <div style={{ flex: 1 }} />

      <span className="text-muted" style={{ fontSize: 11, maxWidth: 300, overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl' }}>
        {pdfFilename}
      </span>
    </div>
  );
}
