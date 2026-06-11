import React, { useEffect, useRef, useState } from 'react';
import { UTILITY_COLORS, AREA_COLORS, ANNOTATION_COLOR, type UtilityType, type AnnotationKind } from './types';

function Separator() {
  return <div className="tk-sep" />;
}

/** Keys for the overlay layer visibility toggles */
export type LayerKey = UtilityType | 'items' | 'areas' | 'annotations';

const LAYER_OPTIONS: { key: LayerKey; label: string; color: string }[] = [
  { key: 'sanitary', label: 'Sanitary Sewer', color: UTILITY_COLORS.sanitary },
  { key: 'storm', label: 'Storm Drain', color: UTILITY_COLORS.storm },
  { key: 'water', label: 'Water', color: UTILITY_COLORS.water },
  { key: 'fiber', label: 'Fiber / Conduit', color: UTILITY_COLORS.fiber },
  { key: 'other', label: 'Other Runs', color: UTILITY_COLORS.other },
  { key: 'items', label: 'Count Items', color: '#e91e63' },
  { key: 'areas', label: 'Areas', color: AREA_COLORS.asphalt },
  { key: 'annotations', label: 'Annotations', color: ANNOTATION_COLOR },
];

/* ---- 16px stroke icons (feather-style, consistent with the app sidebar) ---- */

const ic = (paths: React.ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths}</svg>
);

const Icons = {
  back: ic(<><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>),
  open: ic(<><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></>),
  prev: ic(<polyline points="15 18 9 12 15 6" />),
  next: ic(<polyline points="9 18 15 12 9 6" />),
  zoomIn: ic(<><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16" y2="16" /><line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" /></>),
  zoomOut: ic(<><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16" y2="16" /><line x1="8" y1="11" x2="14" y2="11" /></>),
  fit: ic(<><polyline points="9 21 3 21 3 15" /><polyline points="15 3 21 3 21 9" /><line x1="3" y1="21" x2="10" y2="14" /><line x1="21" y1="3" x2="14" y2="10" /></>),
  rotate: ic(<><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></>),
  undo: ic(<><polyline points="9 14 4 9 9 4" /><path d="M20 20v-7a4 4 0 0 0-4-4H4" /></>),
  redo: ic(<><polyline points="15 14 20 9 15 4" /><path d="M4 20v-7a4 4 0 0 1 4-4h12" /></>),
  ruler: ic(<><path d="M21.3 8.7l-6-6L2.7 15.3l6 6L21.3 8.7z" /><line x1="14.5" y1="5.5" x2="16.5" y2="7.5" /><line x1="11.5" y1="8.5" x2="13.5" y2="10.5" /><line x1="8.5" y1="11.5" x2="10.5" y2="13.5" /><line x1="5.5" y1="14.5" x2="7.5" y2="16.5" /></>),
  select: ic(<path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />),
  run: ic(<><circle cx="5" cy="19" r="2" /><circle cx="12" cy="9" r="2" /><circle cx="19" cy="14" r="2" /><line x1="6" y1="17.2" x2="11" y2="10.8" /><line x1="13.8" y1="10.3" x2="17.4" y2="12.9" /></>),
  area: ic(<><path d="M4 8L9 4l11 3-2 13-12-2z" /><circle cx="4" cy="8" r="1.5" fill="currentColor" /><circle cx="9" cy="4" r="1.5" fill="currentColor" /><circle cx="20" cy="7" r="1.5" fill="currentColor" /><circle cx="18" cy="20" r="1.5" fill="currentColor" /><circle cx="6" cy="18" r="1.5" fill="currentColor" /></>),
  annotate: ic(<><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></>),
  layers: ic(<><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></>),
  export: ic(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>),
  text: ic(<><polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" /></>, 14),
  arrow: ic(<><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></>, 14),
  cloud: ic(<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />, 14),
  chevDown: (
    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
  ),
};

const ANNOTATION_OPTIONS: { kind: AnnotationKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'text', label: 'Text Note', icon: Icons.text },
  { kind: 'arrow', label: 'Arrow', icon: Icons.arrow },
  { kind: 'cloud', label: 'Revision Cloud', icon: Icons.cloud },
];

interface ToolBtnProps {
  icon: React.ReactNode;
  label?: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}

function ToolBtn({ icon, label, title, onClick, disabled, active }: ToolBtnProps) {
  return (
    <button
      className={`tk-btn${active ? ' tk-btn-active' : ''}${label ? ' tk-btn-primary' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
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
  onSetPage: (page: number) => void;
  // Zoom
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
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
  // Annotations
  canAnnotate: boolean;
  onStartAnnotation: (kind: AnnotationKind) => void;
  isAnnotating: boolean;
  // Multi-select
  selectMode: boolean;
  onToggleSelectMode: () => void;
  canSelect: boolean;
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
}

export default function TakeoffToolbar(props: TakeoffToolbarProps) {
  const {
    onBack,
    onLoadPlan, loading,
    pageNum, totalPages, onPrevPage, onNextPage, onSetPage,
    zoomPercent, onZoomIn, onZoomOut, onFitToWidth,
    calibrating, onToggleCalibrate, canCalibrate, scaleDisplay,
    canAddRun, onAddRun, isDrawing,
    canAddArea, onAddArea, isDrawingArea,
    canAnnotate, onStartAnnotation, isAnnotating,
    selectMode, onToggleSelectMode, canSelect,
    onRotatePage, canRotate,
    canUndo, canRedo, onUndo, onRedo,
    hiddenLayers, onToggleLayer,
    canExport, onExportCsv,
  } = props;

  const [layersOpen, setLayersOpen] = useState(false);
  const layersRef = useRef<HTMLDivElement>(null);
  const [annotateOpen, setAnnotateOpen] = useState(false);
  const annotateRef = useRef<HTMLDivElement>(null);

  // Page number input is buffered so partial typing doesn't jump pages
  const [pageDraft, setPageDraft] = useState(String(pageNum));
  useEffect(() => { setPageDraft(String(pageNum)); }, [pageNum]);

  const commitPageDraft = () => {
    const n = parseInt(pageDraft, 10);
    if (!isNaN(n) && n >= 1 && n <= totalPages && n !== pageNum) {
      onSetPage(n);
    } else {
      setPageDraft(String(pageNum));
    }
  };

  useEffect(() => {
    if (!layersOpen && !annotateOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (layersRef.current && !layersRef.current.contains(e.target as Node)) {
        setLayersOpen(false);
      }
      if (annotateRef.current && !annotateRef.current.contains(e.target as Node)) {
        setAnnotateOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [layersOpen, annotateOpen]);

  return (
    <div className="tk-toolbar">
      <ToolBtn icon={Icons.back} title="Back to Job" onClick={onBack} />
      <Separator />

      <ToolBtn icon={Icons.open} title="Open plan PDF" onClick={onLoadPlan} disabled={loading} />
      <ToolBtn icon={Icons.export} title="Export takeoff quantities to CSV"
        onClick={onExportCsv} disabled={!canExport} />
      <Separator />

      <ToolBtn icon={Icons.undo} title="Undo (Ctrl+Z)" onClick={onUndo} disabled={!canUndo} />
      <ToolBtn icon={Icons.redo} title="Redo (Ctrl+Y)" onClick={onRedo} disabled={!canRedo} />
      <Separator />

      <ToolBtn icon={Icons.prev} title="Previous page (←)" onClick={onPrevPage} disabled={pageNum <= 1} />
      <input
        className="tk-page-input"
        value={pageDraft}
        onChange={(e) => setPageDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commitPageDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setPageDraft(String(pageNum)); (e.target as HTMLInputElement).blur(); }
        }}
        title="Go to page"
        aria-label="Page number"
      />
      <span className="tk-readout">/ {totalPages || '—'}</span>
      <ToolBtn icon={Icons.next} title="Next page (→)" onClick={onNextPage} disabled={pageNum >= totalPages} />
      <Separator />

      <ToolBtn icon={Icons.zoomOut} title="Zoom out (-)" onClick={onZoomOut} />
      <span className="tk-readout" style={{ minWidth: 38, textAlign: 'center' }}>{zoomPercent}%</span>
      <ToolBtn icon={Icons.zoomIn} title="Zoom in (+)" onClick={onZoomIn} />
      <ToolBtn icon={Icons.fit} title="Fit to width (Ctrl+0)" onClick={onFitToWidth} />
      <ToolBtn icon={Icons.rotate} title="Rotate page 90° clockwise" onClick={onRotatePage} disabled={!canRotate} />
      <Separator />

      <ToolBtn icon={Icons.ruler} label="Scale" title={scaleDisplay
        ? `Recalibrate plan scale (current: ${scaleDisplay})` : 'Calibrate the plan scale'}
        onClick={onToggleCalibrate} disabled={!canCalibrate} active={calibrating} />
      <Separator />

      <ToolBtn icon={Icons.select} label="Select" active={selectMode} disabled={!canSelect}
        title="Select multiple objects — drag a rectangle (Esc to exit)" onClick={onToggleSelectMode} />
      <ToolBtn icon={Icons.run} label="Run" active={isDrawing} disabled={!canAddRun}
        title={!canAddRun && !isDrawing ? 'Calibrate scale first' : 'Measure a pipe run — click to place points, Esc to finish'}
        onClick={onAddRun} />
      <ToolBtn icon={Icons.area} label="Area" active={isDrawingArea} disabled={!canAddArea}
        title={!canAddArea && !isDrawingArea ? 'Calibrate scale first' : 'Measure a surface area (pavement patch, restoration)'}
        onClick={onAddArea} />

      <div ref={annotateRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          className={`tk-btn tk-btn-primary${isAnnotating ? ' tk-btn-active' : ''}`}
          onClick={() => setAnnotateOpen((o) => !o)}
          disabled={!canAnnotate}
          title="Add a text note, arrow, or revision cloud"
        >
          {Icons.annotate}
          <span>Markup</span>
          {Icons.chevDown}
        </button>
        {annotateOpen && (
          <div className="tk-menu" style={{ left: 0 }}>
            {ANNOTATION_OPTIONS.map((opt) => (
              <div key={opt.kind} className="tk-menu-item"
                onClick={() => { setAnnotateOpen(false); onStartAnnotation(opt.kind); }}>
                {opt.icon}
                {opt.label}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 8 }} />

      <div ref={layersRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          className={`tk-btn tk-btn-primary${hiddenLayers.size > 0 ? ' tk-btn-active' : ''}`}
          onClick={() => setLayersOpen((o) => !o)}
          title="Show/hide takeoff layers"
        >
          {Icons.layers}
          <span>Layers{hiddenLayers.size > 0 ? ` (${LAYER_OPTIONS.length - hiddenLayers.size}/${LAYER_OPTIONS.length})` : ''}</span>
          {Icons.chevDown}
        </button>
        {layersOpen && (
          <div className="tk-menu" style={{ right: 0 }}>
            {LAYER_OPTIONS.map((opt) => {
              const visible = !hiddenLayers.has(opt.key);
              return (
                <label key={opt.key} className="tk-menu-item">
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
    </div>
  );
}
