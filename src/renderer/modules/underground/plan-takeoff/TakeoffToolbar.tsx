import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, FolderOpen, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2,
  RotateCw, Undo2, Redo2, Ruler, MousePointer2, Waypoints, Pentagon, Spline,
  Pencil, Layers, Download, Triangle, Grid2x2, Mountain, Type, ArrowUpRight,
  Cloud, ChevronDown, Search,
} from 'lucide-react';
import { UTILITY_COLORS, AREA_COLORS, ANNOTATION_COLOR, WALL_COLOR, type UtilityType, type AnnotationKind } from './types';

function Separator() {
  return <div className="tk-sep" />;
}

/** Keys for the overlay layer visibility toggles */
export type LayerKey = UtilityType | 'items' | 'areas' | 'walls' | 'annotations';

const LAYER_OPTIONS: { key: LayerKey; label: string; color: string }[] = [
  { key: 'sanitary', label: 'Sanitary Sewer', color: UTILITY_COLORS.sanitary },
  { key: 'storm', label: 'Storm Drain', color: UTILITY_COLORS.storm },
  { key: 'water', label: 'Water', color: UTILITY_COLORS.water },
  { key: 'fiber', label: 'Fiber / Conduit', color: UTILITY_COLORS.fiber },
  { key: 'other', label: 'Other Runs', color: UTILITY_COLORS.other },
  { key: 'items', label: 'Count Items', color: '#e91e63' },
  { key: 'areas', label: 'Areas', color: AREA_COLORS.asphalt },
  { key: 'walls', label: 'Walls', color: WALL_COLOR },
  { key: 'annotations', label: 'Annotations', color: ANNOTATION_COLOR },
];

/* ---- toolbar icons (lucide-react, 16px / 1.8 stroke to match the app shell) ---- */

const SZ = 16;
const SW = 1.8;

const Icons = {
  back: <ArrowLeft size={SZ} strokeWidth={SW} />,
  open: <FolderOpen size={SZ} strokeWidth={SW} />,
  prev: <ChevronLeft size={SZ} strokeWidth={SW} />,
  next: <ChevronRight size={SZ} strokeWidth={SW} />,
  zoomIn: <ZoomIn size={SZ} strokeWidth={SW} />,
  zoomOut: <ZoomOut size={SZ} strokeWidth={SW} />,
  fit: <Maximize2 size={SZ} strokeWidth={SW} />,
  rotate: <RotateCw size={SZ} strokeWidth={SW} />,
  undo: <Undo2 size={SZ} strokeWidth={SW} />,
  redo: <Redo2 size={SZ} strokeWidth={SW} />,
  ruler: <Ruler size={SZ} strokeWidth={SW} />,
  loupe: <Search size={SZ} strokeWidth={SW} />,
  select: <MousePointer2 size={SZ} strokeWidth={SW} />,
  run: <Waypoints size={SZ} strokeWidth={SW} />,
  area: <Pentagon size={SZ} strokeWidth={SW} />,
  wall: <Spline size={SZ} strokeWidth={SW} />,
  annotate: <Pencil size={SZ} strokeWidth={SW} />,
  layers: <Layers size={SZ} strokeWidth={SW} />,
  export: <Download size={SZ} strokeWidth={SW} />,
  elevation: <Triangle size={SZ} strokeWidth={SW} />,
  heatmap: <Grid2x2 size={SZ} strokeWidth={SW} />,
  earthwork: <Mountain size={SZ} strokeWidth={SW} />,
  text: <Type size={14} strokeWidth={SW} />,
  arrow: <ArrowUpRight size={14} strokeWidth={SW} />,
  cloud: <Cloud size={14} strokeWidth={SW} />,
  chevDown: <ChevronDown size={8} strokeWidth={3} />,
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
  /**
   * True while a shape is being drawn. Page navigation is refused in that
   * state (a shape cannot span two calibrations), so the controls say so
   * instead of silently doing nothing.
   */
  pageNavLocked?: boolean;
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
  // Walls
  canAddWall: boolean;
  onAddWall: () => void;
  isDrawingWall: boolean;
  // Annotations
  canAnnotate: boolean;
  onStartAnnotation: (kind: AnnotationKind) => void;
  isAnnotating: boolean;
  // Earthwork
  canCaptureElev: boolean;
  captureElev: boolean;
  onToggleCaptureElev: () => void;
  surfacePointCount: number;
  showHeatmap: boolean;
  onToggleHeatmap: () => void;
  canSendEarthwork: boolean;
  onSendEarthworkToBid: () => void;
  // Multi-select
  selectMode: boolean;
  onToggleSelectMode: () => void;
  canSelect: boolean;
  loupeOn: boolean;
  onToggleLoupe: () => void;
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
    pageNum, totalPages, pageNavLocked, onPrevPage, onNextPage, onSetPage,
    zoomPercent, onZoomIn, onZoomOut, onFitToWidth,
    calibrating, onToggleCalibrate, canCalibrate, scaleDisplay,
    canAddRun, onAddRun, isDrawing,
    canAddArea, onAddArea, isDrawingArea,
    canAddWall, onAddWall, isDrawingWall,
    canAnnotate, onStartAnnotation, isAnnotating,
    canCaptureElev, captureElev, onToggleCaptureElev, surfacePointCount,
    showHeatmap, onToggleHeatmap, canSendEarthwork, onSendEarthworkToBid,
    selectMode, onToggleSelectMode, canSelect,
    loupeOn, onToggleLoupe,
    onRotatePage, canRotate,
    canUndo, canRedo, onUndo, onRedo,
    hiddenLayers, onToggleLayer,
    canExport, onExportCsv,
  } = props;

  // Menus are position: fixed (anchored from the button's screen rect) so
  // they aren't clipped by the toolbar's overflow-x scrolling.
  const [layersOpen, setLayersOpen] = useState(false);
  const layersRef = useRef<HTMLDivElement>(null);
  const [layersPos, setLayersPos] = useState({ top: 0, right: 0 });
  const [annotateOpen, setAnnotateOpen] = useState(false);
  const annotateRef = useRef<HTMLDivElement>(null);
  const [annotatePos, setAnnotatePos] = useState({ top: 0, left: 0 });

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

      <ToolBtn
        icon={Icons.prev}
        title={pageNavLocked ? 'Finish or cancel the shape you are drawing first' : 'Previous page (←)'}
        onClick={onPrevPage}
        disabled={pageNavLocked || pageNum <= 1}
      />
      <input
        className="tk-page-input"
        value={pageDraft}
        disabled={pageNavLocked}
        onChange={(e) => setPageDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commitPageDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setPageDraft(String(pageNum)); (e.target as HTMLInputElement).blur(); }
        }}
        title={pageNavLocked ? 'Finish or cancel the shape you are drawing first' : 'Go to page'}
        aria-label="Page number"
      />
      <span className="tk-readout">/ {totalPages || '—'}</span>
      <ToolBtn
        icon={Icons.next}
        title={pageNavLocked ? 'Finish or cancel the shape you are drawing first' : 'Next page (→)'}
        onClick={onNextPage}
        disabled={pageNavLocked || pageNum >= totalPages}
      />
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

      <ToolBtn icon={Icons.loupe} label="Magnify" active={loupeOn}
        title="Magnifier: read small plan text without changing zoom (M)"
        onClick={onToggleLoupe} />
      <Separator />

      <ToolBtn icon={Icons.select} label="Select" active={selectMode} disabled={!canSelect}
        title="Select multiple objects by dragging a rectangle (Esc to exit)" onClick={onToggleSelectMode} />
      <ToolBtn icon={Icons.run} label="Run" active={isDrawing} disabled={!canAddRun}
        title={!canAddRun && !isDrawing ? 'Calibrate scale first' : 'Measure a pipe run: click to place points, Esc to finish'}
        onClick={onAddRun} />
      <ToolBtn icon={Icons.area} label="Area" active={isDrawingArea} disabled={!canAddArea}
        title={!canAddArea && !isDrawingArea ? 'Calibrate scale first' : 'Measure a surface area (pavement patch, restoration)'}
        onClick={onAddArea} />
      <ToolBtn icon={Icons.wall} label="Wall" active={isDrawingWall} disabled={!canAddWall}
        title={!canAddWall && !isDrawingWall ? 'Calibrate scale first' : 'Trace a wall run (length × height → concrete, formwork, rebar)'}
        onClick={onAddWall} />

      <div ref={annotateRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          className={`tk-btn tk-btn-primary${isAnnotating ? ' tk-btn-active' : ''}`}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setAnnotatePos({ top: rect.bottom, left: rect.left });
            setAnnotateOpen((o) => !o);
          }}
          disabled={!canAnnotate}
          title="Add a text note, arrow, or revision cloud"
        >
          {Icons.annotate}
          <span>Markup</span>
          {Icons.chevDown}
        </button>
        {annotateOpen && (
          <div className="tk-menu" style={{ top: annotatePos.top, left: annotatePos.left }}>
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

      <Separator />
      <ToolBtn icon={Icons.elevation} label="Elev" active={captureElev} disabled={!canCaptureElev}
        title={!canCaptureElev
          ? 'Open a plan to capture existing-grade spot elevations'
          : `Capture existing-grade spot elevations — click the plan (${surfacePointCount} captured)`}
        onClick={onToggleCaptureElev} />
      <ToolBtn icon={Icons.heatmap} label="Cut/Fill" active={showHeatmap}
        title="Toggle the cut/fill heatmap for finished-elevation earthwork" onClick={onToggleHeatmap} />
      <ToolBtn icon={Icons.earthwork} label="Earthwork" disabled={!canSendEarthwork}
        title={!canSendEarthwork ? 'No earthwork regions to send' : 'Send earthwork cut/fill volumes to the bid'}
        onClick={onSendEarthworkToBid} />

      <div style={{ flex: 1, minWidth: 8 }} />

      <div ref={layersRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          className={`tk-btn tk-btn-primary${hiddenLayers.size > 0 ? ' tk-btn-active' : ''}`}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setLayersPos({ top: rect.bottom, right: window.innerWidth - rect.right });
            setLayersOpen((o) => !o);
          }}
          title="Show/hide takeoff layers"
        >
          {Icons.layers}
          <span>Layers{hiddenLayers.size > 0 ? ` (${LAYER_OPTIONS.length - hiddenLayers.size}/${LAYER_OPTIONS.length})` : ''}</span>
          {Icons.chevDown}
        </button>
        {layersOpen && (
          <div className="tk-menu" style={{ top: layersPos.top, right: layersPos.right }}>
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
