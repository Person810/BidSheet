import React, { useEffect, useRef, useState } from 'react';
import { UTILITY_COLORS, AREA_COLORS, type UtilityType } from './types';

function Separator() {
  return <div style={{ width: 1, height: 20, background: 'var(--border-color, #ddd)', margin: '0 4px' }} />;
}

/** Keys for the overlay layer visibility toggles */
export type LayerKey = UtilityType | 'items' | 'areas';

const LAYER_OPTIONS: { key: LayerKey; label: string; color: string }[] = [
  { key: 'sanitary', label: 'Sanitary Sewer', color: UTILITY_COLORS.sanitary },
  { key: 'storm', label: 'Storm Drain', color: UTILITY_COLORS.storm },
  { key: 'water', label: 'Water', color: UTILITY_COLORS.water },
  { key: 'fiber', label: 'Fiber / Conduit', color: UTILITY_COLORS.fiber },
  { key: 'other', label: 'Other Runs', color: UTILITY_COLORS.other },
  { key: 'items', label: 'Count Items', color: '#e91e63' },
  { key: 'areas', label: 'Areas', color: AREA_COLORS.asphalt },
];

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
  // Areas
  canAddArea: boolean;
  onAddArea: () => void;
  isDrawingArea: boolean;
  // Rotation
  onRotatePage: () => void;
  canRotate: boolean;
  // Undo/redo
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  // Layers
  hiddenLayers: Set<LayerKey>;
  onToggleLayer: (key: LayerKey) => void;
  // Export
  canExport: boolean;
  onExportCsv: () => void;
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
    canAddArea, onAddArea, isDrawingArea,
    onRotatePage, canRotate,
    canUndo, canRedo, onUndo, onRedo,
    hiddenLayers, onToggleLayer,
    canExport, onExportCsv,
    pdfFilename,
  } = props;

  const [layersOpen, setLayersOpen] = useState(false);
  const layersRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!layersOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (layersRef.current && !layersRef.current.contains(e.target as Node)) {
        setLayersOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [layersOpen]);

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
      <button className="btn btn-secondary btn-sm" onClick={onRotatePage} disabled={!canRotate}
        title="Rotate page 90° clockwise">
        &#8635;
      </button>
      <Separator />

      <button className="btn btn-secondary btn-sm" onClick={onUndo} disabled={!canUndo}
        title="Undo (Ctrl+Z)">
        &#8617;
      </button>
      <button className="btn btn-secondary btn-sm" onClick={onRedo} disabled={!canRedo}
        title="Redo (Ctrl+Y)">
        &#8618;
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

      <button
        className="btn btn-primary btn-sm"
        onClick={onAddArea}
        disabled={!canAddArea}
        title={!canAddArea ? 'Calibrate scale first' : 'Measure a surface area (pavement patch, restoration)'}
      >
        Add Area
      </button>

      {(isDrawing || isDrawingArea) && (
        <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500 }}>
          Drawing &mdash; click to place, right-click to undo, Esc to finish
        </span>
      )}

      <div style={{ flex: 1 }} />

      <div ref={layersRef} style={{ position: 'relative' }}>
        <button
          className={`btn btn-sm ${hiddenLayers.size > 0 ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setLayersOpen((o) => !o)}
          title="Show/hide takeoff layers"
        >
          Layers{hiddenLayers.size > 0 ? ` (${LAYER_OPTIONS.length - hiddenLayers.size}/${LAYER_OPTIONS.length})` : ''}
        </button>
        {layersOpen && (
          <div style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 900,
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '6px 0', minWidth: 180,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}>
            {LAYER_OPTIONS.map((opt) => {
              const visible = !hiddenLayers.has(opt.key);
              return (
                <label key={opt.key} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px',
                  fontSize: 12, cursor: 'pointer', color: 'var(--text-primary)',
                }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={() => onToggleLayer(opt.key)}
                    style={{ margin: 0 }}
                  />
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: opt.color, flexShrink: 0 }} />
                  <span>{opt.label}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <button
        className="btn btn-secondary btn-sm"
        onClick={onExportCsv}
        disabled={!canExport}
        title="Export takeoff quantities to CSV"
      >
        Export CSV
      </button>

      <span className="text-muted" style={{ fontSize: 11, maxWidth: 300, overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl' }}>
        {pdfFilename}
      </span>
    </div>
  );
}
