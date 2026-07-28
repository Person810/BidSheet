import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { ArrowLeft, FileText, Hand, Ruler } from 'lucide-react';
import { PdfViewer, MIN_SCALE, MAX_SCALE } from './PdfViewer';
import { DrawingOverlay, screenToPdf } from './DrawingOverlay';
import { useScaleCalibration, formatScale } from './ScaleCalibration';
import type { ScaleResult } from './ScaleCalibration';
import { TrenchConfigModal } from './TrenchConfigModal';
import { AreaConfigModal } from './AreaConfigModal';
import { WallConfigModal } from './WallConfigModal';
import { SummaryPanel, type SummaryTab } from './SummaryPanel';
import { useRunManager } from './useRunManager';
import { useItemManager } from './useItemManager';
import { useNodeManager } from './useNodeManager';
import { useAreaManager } from './useAreaManager';
import { useWallManager } from './useWallManager';
import { useAnnotationManager } from './useAnnotationManager';
import { useTakeoffHistory } from './useTakeoffHistory';
import { rectContains, normalizeRect, orthoConstrainPoint, type MarqueeRect } from './takeoffUtils';
import { UTILITY_COLORS, type UtilityType, type AnnotationKind } from './types';
import TakeoffToolbar, { type LayerKey } from './TakeoffToolbar';
import ItemPickerModal from './ItemPickerModal';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { useToastStore } from '../../../stores/toast-store';
import { useUnitSystem } from '../../../stores/units-store';
import { fromDisplay, unitLabel } from '../../../../shared/unitSystem';
import { sendToProfiles } from './sendToProfiles';
import { sendItemsToBid } from './sendItemsToBid';
import { sendAreasToBid } from './sendAreasToBid';
import { sendWallsToBid } from './sendWallsToBid';
import { sendEarthworkToBid } from './sendEarthworkToBid';
import { useSurfaceManager } from './useSurfaceManager';
import { buildGroundSampler } from './surfaceSampler';
import SurfaceOverlay from './SurfaceOverlay';
import WallOverlay from './WallOverlay';
import { buildTakeoffCsv } from './exportTakeoffCsv';
import { reportSaveError } from './takeoffPersistence';
import { ContextMenu, getMenuItems } from './ContextMenu';
import { EditVertexDialog } from './EditVertexDialog';
import { RunProfileView } from './RunProfileView';
import type { TakeoffJobSettings, PdfPoint, ContextMenuState } from './types';
import { dismissOnEscOnly } from '../../../components/modalDismiss';

// three.js / R3F is heavy and only needed when the 3D toggle is used, so it's
// code-split out of the main takeoff bundle and loaded on first 3D view.
const Trench3DView = React.lazy(() =>
  import('./Trench3DView').then((m) => ({ default: m.Trench3DView })));

interface PlanTakeoffProps {
  jobId: number;
  onBack: () => void;
}

export function PlanTakeoff({ jobId, onBack }: PlanTakeoffProps) {
  const system = useUnitSystem();
  const [jobSettings, setJobSettings] = useState<TakeoffJobSettings | null>(null);

  // -- PDF state --
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [resetPanKey, setResetPanKey] = useState(0);

  const [viewport, setViewport] = useState({ panX: 0, panY: 0, renderedScale: 1, cssZoom: 1 });
  const [calibrating, setCalibrating] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);

  // -- Per-page scale --
  const [pageScalePxPerFt, setPageScalePxPerFt] = useState<number | null>(null);

  // -- Per-page rotation --
  const [pageRotation, setPageRotation] = useState(0);

  // -- Context menu --
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingVertex, setEditingVertex] = useState<{ runId: number; vertexIndex: number } | null>(null);
  const [profileRunId, setProfileRunId] = useState<number | null>(null);
  const [profileMode, setProfileMode] = useState<'2d' | '3d'>('2d');

  // -- Item placement via context menu --
  const [pendingItemPlacement, setPendingItemPlacement] = useState<{ runId: number | null; point: PdfPoint; pipeSizeIn?: number } | null>(null);
  const [summaryTab, setSummaryTab] = useState<SummaryTab>('runs');

  // -- Layer visibility --
  const [hiddenLayers, setHiddenLayers] = useState<Set<LayerKey>>(new Set());
  const toggleLayer = useCallback((key: LayerKey) => {
    setHiddenLayers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const pageSizeRef = useRef({ width: 0, height: 0 });
  const viewerWrapRef = useRef<HTMLDivElement>(null);
  const editingItemIdRef = useRef<number | null>(null);

  // Calibration hook
  const calibration = useScaleCalibration({
    active: calibrating,
    pageWidth: pageSizeRef.current.width,
    pageHeight: pageSizeRef.current.height,
    system,
    onComplete: async (result: ScaleResult) => {
      try {
        await window.api.savePageScale({
          job_id: jobId,
          page_number: pageNum,
          scale_px_per_ft: result.pxPerFt,
          scale_point1_x: result.point1?.x ?? null,
          scale_point1_y: result.point1?.y ?? null,
          scale_point2_x: result.point2?.x ?? null,
          scale_point2_y: result.point2?.y ?? null,
          scale_distance_ft: result.distanceFt ?? null,
        });
        setPageScalePxPerFt(result.pxPerFt);
      } catch (err) {
        addToast('Failed to save scale calibration', 'error');
      } finally {
        setCalibrating(false);
      }
    },
    onCancel: () => setCalibrating(false),
  });

  // Node manager hook
  const nm = useNodeManager({ jobId, pageNum });

  // Run manager hook
  const rm = useRunManager({
    jobId,
    pageNum,
    calibrating,
    calibrationHandlePointClick: calibration.handlePointClick,
    nodeManager: nm,
  });

  // Item manager hook
  const im = useItemManager({ jobId, pageNum });

  // Area manager hook
  const am = useAreaManager({ jobId, pageNum });

  // Wall manager hook
  const wm = useWallManager({ jobId, pageNum });

  // Annotation manager hook
  const anm = useAnnotationManager({ jobId, pageNum });

  // Surface (existing-grade spot elevations) hook + earthwork view state
  const sm = useSurfaceManager({ jobId });
  const [captureElev, setCaptureElev] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [pendingElev, setPendingElev] = useState<{ point: PdfPoint; pdfPage: number } | null>(null);
  const [elevInput, setElevInput] = useState('');

  // Spot elevations + earthwork areas on the current page, for the overlay.
  const pageSurfacePoints = useMemo(
    () => sm.points.filter((p) => p.pdfPage === pageNum),
    [sm.points, pageNum],
  );

  // -- Annotation text modal --
  const [editingAnnotationId, setEditingAnnotationId] = useState<number | null>(null);
  const [annotationText, setAnnotationText] = useState('');
  const showAnnotationTextModal = anm.pendingTextPoint != null || editingAnnotationId != null;

  // -- Marquee multi-select --
  const [selectMode, setSelectMode] = useState(false);
  const [marqueeStart, setMarqueeStart] = useState<PdfPoint | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
  const [multiSelected, setMultiSelected] = useState<{
    runs: Set<number>; items: Set<number>; areas: Set<number>; annotations: Set<number>;
  } | null>(null);

  const clearMultiSelection = useCallback(() => {
    setMultiSelected(null);
    setMarqueeStart(null);
    setMarqueeRect(null);
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    clearMultiSelection();
  }, [clearMultiSelection]);

  // -- Undo/redo history --
  // State is read through a ref so record() always sees the latest values
  // without re-creating callbacks on every render.
  const takeoffStateRef = useRef({ runs: rm.runs, items: im.items, nodes: nm.nodes, areas: am.areas, walls: wm.walls, annotations: anm.annotations });
  takeoffStateRef.current = { runs: rm.runs, items: im.items, nodes: nm.nodes, areas: am.areas, walls: wm.walls, annotations: anm.annotations };
  const getTakeoffState = useCallback(() => takeoffStateRef.current, []);
  const reloadAll = useCallback(async () => {
    await Promise.all([rm.reload(), im.reload(), nm.reload(), am.reload(), wm.reload(), anm.reload()]);
  }, [rm.reload, im.reload, nm.reload, am.reload, wm.reload, anm.reload]);
  const history = useTakeoffHistory({ jobId, getState: getTakeoffState, reloadAll });

  // Send to Trench Profiles / Send Items to Bid / Send Areas to Bid
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [showSendItemsConfirm, setShowSendItemsConfirm] = useState(false);
  const [showSendAreasConfirm, setShowSendAreasConfirm] = useState(false);
  const [showSendWallsConfirm, setShowSendWallsConfirm] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  const handleSendToProfiles = useCallback(async () => {
    setShowSendConfirm(false);
    try {
      const { created, warnings } = await sendToProfiles(rm.runs, jobId);
      for (const w of warnings) addToast(w, 'warn');
      addToast(`Created ${created} trench profiles. View them on the job page.`, 'success');
    } catch (err) {
      console.error('Send to trench profiles failed:', err);
      addToast('Failed to create trench profiles', 'error');
    }
  }, [jobId, rm.runs, addToast]);

  const handleSendItemsToBid = useCallback(async () => {
    setShowSendItemsConfirm(false);
    try {
      const count = await sendItemsToBid(im.items, jobId);
      addToast(`Created ${count} line items in "Fittings & Structures" section.`, 'success');
    } catch (err) {
      console.error('Send items to bid failed:', err);
      addToast('Failed to send items to bid', 'error');
    }
  }, [jobId, im.items, addToast]);

  const handleSendAreasToBid = useCallback(async () => {
    setShowSendAreasConfirm(false);
    try {
      const count = await sendAreasToBid(am.areas, jobId, system);
      if (count === 0) {
        addToast('No areas on calibrated pages to send.', 'error');
      } else {
        addToast(`Created ${count} line items in "Surface Restoration" section.`, 'success');
      }
    } catch (err) {
      console.error('Send areas to bid failed:', err);
      addToast('Failed to send areas to bid', 'error');
    }
  }, [jobId, am.areas, addToast, system]);

  const handleSendWallsToBid = useCallback(async () => {
    setShowSendWallsConfirm(false);
    try {
      const { created, warnings } = await sendWallsToBid(wm.walls, jobId, system);
      for (const w of warnings) addToast(w, 'warn');
      if (created === 0) {
        if (warnings.length === 0) addToast('No walls on calibrated pages to send.', 'error');
      } else {
        addToast(`Created ${created} line items in "Walls" section.`, 'success');
      }
    } catch (err) {
      console.error('Send walls to bid failed:', err);
      addToast('Failed to send walls to bid', 'error');
    }
  }, [jobId, wm.walls, addToast, system]);

  const handleExportCsv = useCallback(async () => {
    try {
      const csv = await buildTakeoffCsv(jobId, rm.runs, im.items, am.areas, sm.surface ? [sm.surface] : [], system);
      const result = await window.api.exportTakeoffCsv(jobId, csv);
      if (result?.success) addToast(`Takeoff exported to ${result.path}`, 'success');
    } catch (err) {
      console.error('Takeoff CSV export failed:', err);
      addToast('Failed to export takeoff CSV', 'error');
    }
  }, [jobId, rm.runs, im.items, am.areas, sm.surface, addToast, system]);

  // Load settings on mount
  useEffect(() => {
    window.api.getTakeoffSettings(jobId).then((s: any) => {
      setJobSettings(s || null);
    });
  }, [jobId]);

  // Load per-page scale and rotation when page changes
  useEffect(() => {
    window.api.getPageScale(jobId, pageNum).then((row: any) => {
      setPageScalePxPerFt(row?.scale_px_per_ft ?? null);
    });
    window.api.getPageRotation(jobId, pageNum).then((rotation: number) => {
      setPageRotation(rotation || 0);
    });
  }, [jobId, pageNum]);

  const handleRotatePage = useCallback(() => {
    const next = (pageRotation + 90) % 360;
    setPageRotation(next);
    window.api.savePageRotation(jobId, pageNum, next).catch(() => {
      addToast('Failed to save page rotation', 'error');
    });
  }, [jobId, pageNum, pageRotation, addToast]);

  // Auto-load PDF from saved path
  useEffect(() => {
    if (!jobSettings?.pdf_path) return;
    // Already loaded this exact path — skip
    if (pdfPath === jobSettings.pdf_path) return;
    setPdfPath(jobSettings.pdf_path);
    setLoading(true);
    window.api.readTakeoffPdf(jobSettings.pdf_path).then((result: any) => {
      if (result?.data) {
        setPdfData(new Uint8Array(result.data));
      } else {
        // The PDF was moved or deleted since it was attached. Don't strand the
        // user on a blank "No plan loaded" view with their runs/items hidden —
        // tell them what happened and how to fix it.
        addToast(
          `The saved plan PDF couldn't be found at ${jobSettings.pdf_path}. Re-attach it with "Open plan PDF". Your takeoff data is safe.`,
          'warn',
        );
      }
    }).catch(() => {
      addToast('Couldn\'t open the saved plan PDF. Re-attach it with "Open plan PDF". Your takeoff data is safe.', 'error');
    }).finally(() => setLoading(false));
  }, [jobSettings, pdfPath, addToast]);

  const handleLoadPlan = async () => {
    setLoading(true);
    try {
      const result = await window.api.openTakeoffPdf();
      if (result?.filePath && result?.data) {
        setPdfPath(result.filePath);
        setPdfData(new Uint8Array(result.data));
        setPageNum(1);
        setTotalPages(0);
        setScale(1.0);
        setLoadError(false);

        // The upsert binds every named param, so missing scale fields must
        // be explicit nulls — a partial object throws and nothing persists
        const settings = {
          job_id: jobId,
          pdf_path: result.filePath,
          scale_px_per_ft: jobSettings?.scale_px_per_ft ?? null,
          scale_point1_x: jobSettings?.scale_point1_x ?? null,
          scale_point1_y: jobSettings?.scale_point1_y ?? null,
          scale_point2_x: jobSettings?.scale_point2_x ?? null,
          scale_point2_y: jobSettings?.scale_point2_y ?? null,
          scale_distance_ft: jobSettings?.scale_distance_ft ?? null,
        };
        window.api.saveTakeoffSettings(settings).catch(reportSaveError('plan settings'));
        setJobSettings(settings);
      }
    } catch (err) {
      console.error('Failed to open PDF:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDocLoaded = useCallback((pages: number) => {
    setTotalPages(pages);
    setLoadError(pages === 0);
  }, []);

  const handlePageSizeKnown = useCallback((w: number, h: number) => {
    pageSizeRef.current = { width: w, height: h };
  }, []);

  // Changing pages mid-draw would append the new page's coordinates (in its own
  // calibration) to a run/area anchored on the old page, silently mixing two
  // sheets' coordinate spaces and corrupting lengths/areas. Block nav while any
  // shape is being drawn — finish or Esc first.
  const drawingLocksPage = rm.isDrawing || am.isDrawing || anm.isDrawing;
  const prevPage = useCallback(() => {
    if (rm.isDrawing || am.isDrawing || anm.isDrawing) return;
    setPageNum((p) => Math.max(1, p - 1));
  }, [rm.isDrawing, am.isDrawing, anm.isDrawing]);
  const nextPage = useCallback(() => {
    if (rm.isDrawing || am.isDrawing || anm.isDrawing) return;
    setPageNum((p) => Math.min(totalPages, p + 1));
  }, [totalPages, rm.isDrawing, am.isDrawing, anm.isDrawing]);
  const goToPage = useCallback((page: number) => {
    if (rm.isDrawing || am.isDrawing || anm.isDrawing) return;
    setPageNum(page);
  }, [rm.isDrawing, am.isDrawing, anm.isDrawing]);
  const zoomIn = useCallback(() => setScale((s) => Math.min(MAX_SCALE, s + 0.1)), []);
  const zoomOut = useCallback(() => setScale((s) => Math.max(MIN_SCALE, s - 0.1)), []);
  const handleFitToWidth = useCallback(() => {
    const wrap = viewerWrapRef.current;
    if (!wrap || pageSizeRef.current.width === 0) return;
    const available = wrap.clientWidth - 24;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, available / pageSizeRef.current.width));
    setScale(newScale);
    setResetPanKey((k) => k + 1);
  }, []);

  // Hold Shift to constrain the next point to the nearest axis from the
  // anchor (last placed point while drawing, neighboring vertex while
  // dragging). Axis-aligned in the unrotated drawing frame stays axis-aligned
  // on screen for 90° page rotations.
  const orthoConstrain = useCallback((point: PdfPoint, anchor: PdfPoint | null | undefined): PdfPoint => {
    if (!shiftHeld) return point;
    return orthoConstrainPoint(point, anchor);
  }, [shiftHeld]);

  const activeRunLastPoint = useCallback((): PdfPoint | undefined => {
    const run = rm.runs.find((r) => r.id === rm.activeRunId);
    return run?.points[run.points.length - 1];
  }, [rm.runs, rm.activeRunId]);

  const activeAreaLastPoint = useCallback((): PdfPoint | undefined => {
    const area = am.areas.find((a) => a.id === am.activeAreaId);
    return area?.points[area.points.length - 1];
  }, [am.areas, am.activeAreaId]);

  const activeWallLastPoint = useCallback((): PdfPoint | undefined => {
    const wall = wm.walls.find((w) => w.id === wm.activeWallId);
    return wall?.points[wall.points.length - 1];
  }, [wm.walls, wm.activeWallId]);

  // Route overlay clicks/moves to whichever tool is active.
  // Calibration and run interactions (move-vertex, run drawing) are handled
  // inside rm.handlePointClick; area drawing is checked first since the run
  // manager would silently ignore those clicks.
  const handleOverlayPointClick = useCallback((point: PdfPoint) => {
    if (!calibrating && anm.isDrawing) {
      // Second click completes an arrow/cloud — record before the mutation
      if (anm.pendingKind !== 'text' && anm.startPoint) history.record();
      anm.handlePointClick(point);
      return;
    }
    if (!calibrating && am.isDrawing) {
      am.handlePointClick(orthoConstrain(point, activeAreaLastPoint()));
      return;
    }
    if (!calibrating && wm.isDrawing) {
      wm.handlePointClick(orthoConstrain(point, activeWallLastPoint()));
      return;
    }
    // Confirming a vertex move mutates the run (and possibly a shared node)
    if (!calibrating && rm.interactionMode === 'moveVertex' && rm.movingVertex) {
      history.record();
    }
    rm.handlePointClick(orthoConstrain(point, activeRunLastPoint()));
  }, [calibrating, anm, am, wm, rm, history, orthoConstrain, activeRunLastPoint, activeAreaLastPoint, activeWallLastPoint]);

  // Finish the active run/area, recording history for newly created shapes.
  // Snapshots exclude negative (unsaved) IDs, so a capture taken just before
  // finish equals the pre-creation state.
  const finishActiveRun = useCallback(() => {
    const activeRun = rm.runs.find((r) => r.id === rm.activeRunId);
    if (rm.activeRunId != null && rm.activeRunId < 0 && activeRun && activeRun.points.length >= 2) {
      history.record();
    }
    rm.finishActiveRun();
  }, [rm, history]);

  const finishActiveArea = useCallback(() => {
    const activeArea = am.areas.find((a) => a.id === am.activeAreaId);
    if (activeArea && activeArea.points.length >= 3) {
      history.record();
    }
    am.finishActiveArea();
  }, [am, history]);

  const finishActiveWall = useCallback(() => {
    const activeWall = wm.walls.find((w) => w.id === wm.activeWallId);
    if (activeWall && activeWall.points.length >= 2) {
      history.record();
    }
    wm.finishActiveWall();
  }, [wm, history]);

  const handleOverlayMouseMove = useCallback((point: PdfPoint) => {
    rm.handleMouseMove(orthoConstrain(point, activeRunLastPoint()));
    am.handleMouseMove(orthoConstrain(point, activeAreaLastPoint()));
    wm.handleMouseMove(orthoConstrain(point, activeWallLastPoint()));
    anm.handleMouseMove(point);
  }, [rm, am, wm, anm, orthoConstrain, activeRunLastPoint, activeAreaLastPoint, activeWallLastPoint]);

  // -- Don't lose in-progress drawings --

  // An active run/area lives only in React state until finished. Finish
  // (which saves shapes with enough points) instead of silently discarding
  // when the user leaves the takeoff or closes the app.
  const finishersRef = useRef({ finishActiveRun, finishActiveArea, finishActiveWall });
  finishersRef.current = { finishActiveRun, finishActiveArea, finishActiveWall };

  const handleBack = useCallback(() => {
    finishersRef.current.finishActiveRun();
    finishersRef.current.finishActiveArea();
    finishersRef.current.finishActiveWall();
    onBack();
  }, [onBack]);

  useEffect(() => {
    // App close / reload: the save IPC is fire-and-forget here, but losing
    // that race is no worse than the guaranteed loss without it
    const handler = () => {
      finishersRef.current.finishActiveRun();
      finishersRef.current.finishActiveArea();
      finishersRef.current.finishActiveWall();
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      // Unmount (back button bypassed, job switched, etc.)
      handler();
    };
  }, []);

  // -- Direct vertex/item dragging (no tool active) --

  // History snapshots capture pre-mutation state, so record once at the first
  // real movement of a drag — not on release, when the state already moved.
  const dragRecordedRef = useRef(false);

  const recordDragOnce = useCallback(() => {
    if (!dragRecordedRef.current) {
      history.record();
      dragRecordedRef.current = true;
    }
  }, [history]);

  const handleRunVertexDrag = useCallback((runId: number, vertexIndex: number, point: PdfPoint, commit: boolean) => {
    recordDragOnce();
    // Shift constrains against the previous vertex (or the next one when
    // dragging the run's start point)
    const run = rm.runs.find((r) => r.id === runId);
    const anchor = run ? (vertexIndex > 0 ? run.points[vertexIndex - 1] : run.points[1]) : undefined;
    rm.moveVertexTo(runId, vertexIndex, orthoConstrain(point, anchor), commit);
    if (commit) dragRecordedRef.current = false;
  }, [rm, recordDragOnce, orthoConstrain]);

  const handleAreaVertexDrag = useCallback((areaId: number, vertexIndex: number, point: PdfPoint, commit: boolean) => {
    recordDragOnce();
    const area = am.areas.find((a) => a.id === areaId);
    const anchor = area ? (vertexIndex > 0 ? area.points[vertexIndex - 1] : area.points[1]) : undefined;
    am.moveAreaVertexTo(areaId, vertexIndex, orthoConstrain(point, anchor), commit);
    if (commit) dragRecordedRef.current = false;
  }, [am, recordDragOnce, orthoConstrain]);

  const handleItemDrag = useCallback((itemId: number, point: PdfPoint, commit: boolean) => {
    recordDragOnce();
    im.moveItemTo(itemId, point, commit);
    if (commit) dragRecordedRef.current = false;
  }, [im, recordDragOnce]);

  // -- Marquee selection (handled at the wrapper so it works over all layers) --

  const screenPointToPdf = useCallback((clientX: number, clientY: number): PdfPoint | null => {
    const wrap = viewerWrapRef.current;
    if (!wrap || pageSizeRef.current.width === 0) return null;
    const rect = wrap.getBoundingClientRect();
    return screenToPdf(clientX, clientY, rect, pageSizeRef.current.width, pageSizeRef.current.height,
      viewport.panX, viewport.panY, scale, pageRotation);
  }, [viewport.panX, viewport.panY, scale, pageRotation]);

  const handleMarqueeMouseDown = useCallback((e: React.MouseEvent) => {
    if (!selectMode || e.button !== 0) return;
    const p = screenPointToPdf(e.clientX, e.clientY);
    if (!p) return;
    setMarqueeStart(p);
    setMarqueeRect(null);
  }, [selectMode, screenPointToPdf]);

  const handleMarqueeMouseMove = useCallback((e: React.MouseEvent) => {
    if (!selectMode || !marqueeStart) return;
    const p = screenPointToPdf(e.clientX, e.clientY);
    if (!p) return;
    setMarqueeRect(normalizeRect(marqueeStart, p));
  }, [selectMode, marqueeStart, screenPointToPdf]);

  const handleMarqueeMouseUp = useCallback(() => {
    if (!selectMode || !marqueeStart) return;
    const rect = marqueeRect;
    setMarqueeStart(null);
    setMarqueeRect(null);
    if (!rect || (rect.w < 2 && rect.h < 2)) {
      // A click without a drag clears the selection
      setMultiSelected(null);
      return;
    }
    // Only hit-test objects on visible layers — selecting (and bulk-deleting)
    // things the user can't see would be a footgun
    setMultiSelected({
      runs: new Set(rm.pageRuns
        .filter((r) => !hiddenLayers.has(r.utilityType))
        .filter((r) => r.points.some((p) => rectContains(rect, p))).map((r) => r.id)),
      items: hiddenLayers.has('items') ? new Set<number>() : new Set(
        im.pageItems.filter((i) => rectContains(rect, { x: i.xPx, y: i.yPx })).map((i) => i.id)),
      areas: hiddenLayers.has('areas') ? new Set<number>() : new Set(
        am.pageAreas.filter((a) => a.points.some((p) => rectContains(rect, p))).map((a) => a.id)),
      annotations: hiddenLayers.has('annotations') ? new Set<number>() : new Set(
        anm.pageAnnotations.filter((a) =>
          rectContains(rect, { x: a.x1, y: a.y1 })
          || (a.x2 != null && a.y2 != null && rectContains(rect, { x: a.x2, y: a.y2 }))
        ).map((a) => a.id)),
    });
  }, [selectMode, marqueeStart, marqueeRect, hiddenLayers, rm.pageRuns, im.pageItems, am.pageAreas, anm.pageAnnotations]);

  const multiSelectedCount = multiSelected
    ? multiSelected.runs.size + multiSelected.items.size + multiSelected.areas.size + multiSelected.annotations.size
    : 0;

  const handleBulkDelete = useCallback(async () => {
    if (!multiSelected || multiSelectedCount === 0) return;
    history.record();
    const deletes: Promise<any>[] = [];
    for (const id of multiSelected.runs) if (id > 0) deletes.push(window.api.deleteTakeoffRun(id));
    for (const id of multiSelected.items) if (id > 0) deletes.push(window.api.deleteTakeoffItem(id));
    for (const id of multiSelected.areas) if (id > 0) deletes.push(window.api.deleteTakeoffArea(id));
    for (const id of multiSelected.annotations) if (id > 0) deletes.push(window.api.deleteTakeoffAnnotation(id));
    try {
      await Promise.all(deletes);
      await reloadAll();
      clearMultiSelection();
      addToast(`Deleted ${multiSelectedCount} object${multiSelectedCount !== 1 ? 's' : ''}.`, 'success');
    } catch (err) {
      reportSaveError('bulk delete')(err);
      await reloadAll();
    }
  }, [multiSelected, multiSelectedCount, history, reloadAll, clearMultiSelection, addToast]);

  const handleBulkSetUtility = useCallback(async (utilityType: UtilityType) => {
    if (!multiSelected || multiSelected.runs.size === 0) return;
    history.record();
    try {
      for (const id of multiSelected.runs) {
        const run = rm.runs.find((r) => r.id === id);
        if (run && id > 0) {
          await window.api.saveTakeoffRun({
            ...run, utilityType, color: UTILITY_COLORS[utilityType],
            jobId, sortOrder: rm.runs.indexOf(run),
          });
        }
      }
    } catch (err) {
      reportSaveError('run')(err);
    }
    await reloadAll();
    clearMultiSelection();
  }, [multiSelected, rm.runs, jobId, history, reloadAll, clearMultiSelection]);

  // -- Annotation helpers --

  const handleStartAnnotation = useCallback((kind: AnnotationKind) => {
    exitSelectMode();
    setAnnotationText('');
    anm.startAnnotation(kind);
  }, [anm, exitSelectMode]);

  const handleAnnotationTextSave = useCallback(() => {
    if (annotationText.trim() || editingAnnotationId != null) history.record();
    anm.commitText(annotationText, editingAnnotationId);
    setEditingAnnotationId(null);
    setAnnotationText('');
  }, [annotationText, editingAnnotationId, anm, history]);

  const handleAnnotationTextCancel = useCallback(() => {
    anm.cancelAnnotation();
    setEditingAnnotationId(null);
    setAnnotationText('');
  }, [anm]);

  // Selecting one kind of object clears the others so only one detail view
  // and canvas highlight is active at a time.
  const handleRunSelect = useCallback((runId: number | null) => {
    rm.handleRunSelect(runId);
    if (runId != null) {
      im.selectItem(null);
      am.handleAreaSelect(null);
    }
  }, [rm, im, am]);

  const handleItemSelect = useCallback((id: number | null) => {
    im.selectItem(id);
    if (id != null) {
      rm.handleRunSelect(null);
      am.handleAreaSelect(null);
    }
  }, [rm, im, am]);

  const handleAreaSelect = useCallback((areaId: number | null) => {
    am.handleAreaSelect(areaId);
    if (areaId != null) {
      rm.handleRunSelect(null);
      im.selectItem(null);
    }
  }, [rm, im, am]);

  const handleWallSelect = useCallback((wallId: number | null) => {
    wm.handleWallSelect(wallId);
    if (wallId != null) {
      rm.handleRunSelect(null);
      im.selectItem(null);
      am.handleAreaSelect(null);
    }
  }, [rm, im, am, wm]);

  const handleViewerClick = useCallback((e: React.MouseEvent) => {
    if (rm.isDrawing || am.isDrawing) return;
    // Spot-elevation capture: a click drops a point and prompts for its elevation.
    if (captureElev) {
      const p = screenPointToPdf(e.clientX, e.clientY);
      if (p) { setPendingElev({ point: p, pdfPage: pageNum }); setElevInput(''); }
      return;
    }
    const target = e.target as HTMLElement;
    if (['line', 'circle', 'rect', 'polygon'].includes(target.tagName)) return;
    rm.handleRunSelect(null);
    im.selectItem(null);
    am.handleAreaSelect(null);
  }, [rm, im, am, captureElev, screenPointToPdf, pageNum]);

  const confirmSpotElevation = useCallback(() => {
    if (!pendingElev) return;
    const typed = parseFloat(elevInput);
    if (!Number.isFinite(typed)) { addToast('Enter a valid elevation', 'error'); return; }
    // Typed in the active system's unit; stored elevations are canonical feet
    const z = fromDisplay(typed, 'ft', system);
    sm.addSpotElevation(pendingElev.point, z, pendingElev.pdfPage);
    setPendingElev(null);
    setElevInput('');
  }, [pendingElev, elevInput, sm, addToast, system]);

  const handleSendEarthworkToBid = useCallback(async () => {
    try {
      const { created, warnings } = await sendEarthworkToBid(am.areas, sm.surface ? [sm.surface] : [], jobId, system);
      for (const w of warnings) addToast(w, 'warn');
      if (created === 0) {
        if (warnings.length === 0) addToast('No earthwork regions on calibrated pages to send.', 'error');
      } else {
        addToast(`Created ${created} line items in "Earthwork" section.`, 'success');
      }
    } catch (err) {
      console.error('Send earthwork to bid failed:', err);
      addToast('Failed to send earthwork to bid', 'error');
    }
  }, [am.areas, sm.surface, jobId, addToast, system]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (rm.interactionMode === 'moveVertex') { rm.cancelMoveVertex(); return; }
    if (rm.isDrawing) { rm.undoLastPoint(); return; }
    if (am.isDrawing) { am.undoLastPoint(); return; }
    if (calibrating) return;
    // Canvas-level right-click — compute pdf point for placement
    const wrap = viewerWrapRef.current;
    let pdfPoint: PdfPoint | undefined;
    if (wrap && pageSizeRef.current.width > 0) {
      const rect = wrap.getBoundingClientRect();
      pdfPoint = screenToPdf(e.clientX, e.clientY, rect, pageSizeRef.current.width, pageSizeRef.current.height, viewport.panX, viewport.panY, scale, pageRotation);
    }
    setContextMenu({
      x: e.clientX, y: e.clientY,
      targetType: 'canvas', targetId: null,
      targetData: { pdfPoint },
    });
  }, [rm, am, calibrating, viewport.panX, viewport.panY, scale, pageRotation]);

  const handleVertexContextMenu = useCallback((runId: number, vertexIndex: number, screenX: number, screenY: number) => {
    if (rm.isDrawing || calibrating) return;
    const run = rm.pageRuns.find((r) => r.id === runId);
    const nodeId = run?.points[vertexIndex]?.nodeId ?? null;
    setContextMenu({
      x: screenX, y: screenY,
      targetType: 'vertex', targetId: runId,
      targetData: { vertexIndex, nodeId },
    });
  }, [rm.isDrawing, rm.pageRuns, calibrating]);

  const handleSegmentContextMenu = useCallback((runId: number, segmentIndex: number, screenX: number, screenY: number, pdfPoint: PdfPoint) => {
    if (rm.isDrawing || calibrating) return;
    setContextMenu({
      x: screenX, y: screenY,
      targetType: 'segment', targetId: runId,
      targetData: { segmentIndex, pdfPoint },
    });
  }, [rm.isDrawing, calibrating]);

  const handleItemContextMenu = useCallback((itemId: number, screenX: number, screenY: number) => {
    if (rm.isDrawing || calibrating) return;
    const item = im.pageItems.find((i) => i.id === itemId);
    const targetType = item?.nearRunId ? 'fitting' : 'countItem';
    setContextMenu({
      x: screenX, y: screenY,
      targetType, targetId: itemId,
      targetData: {},
    });
  }, [rm.isDrawing, calibrating, im.pageItems]);

  const handleAreaContextMenu = useCallback((areaId: number, screenX: number, screenY: number) => {
    if (rm.isDrawing || am.isDrawing || calibrating) return;
    setContextMenu({
      x: screenX, y: screenY,
      targetType: 'area', targetId: areaId,
      targetData: {},
    });
  }, [rm.isDrawing, am.isDrawing, calibrating]);

  const handleAnnotationContextMenu = useCallback((id: number, screenX: number, screenY: number) => {
    if (rm.isDrawing || am.isDrawing || anm.isDrawing || calibrating) return;
    setContextMenu({
      x: screenX, y: screenY,
      targetType: 'annotation', targetId: id,
      targetData: {},
    });
  }, [rm.isDrawing, am.isDrawing, anm.isDrawing, calibrating]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleContextMenuAction = useCallback((action: string) => {
    if (!contextMenu) return;
    const { targetType, targetId, targetData } = contextMenu;

    switch (action) {
      // Vertex actions
      case 'insertFitting': {
        if (targetId != null && targetData.vertexIndex != null) {
          const run = rm.pageRuns.find((r) => r.id === targetId);
          if (run) {
            const pt = run.points[targetData.vertexIndex];
            setPendingItemPlacement({ runId: targetId, point: pt, pipeSizeIn: run.pipeSizeIn });
          }
        }
        break;
      }
      // Segment actions
      case 'insertFittingHere': {
        if (targetId != null && targetData.pdfPoint) {
          const run = rm.pageRuns.find((r) => r.id === targetId);
          setPendingItemPlacement({ runId: targetId, point: targetData.pdfPoint, pipeSizeIn: run?.pipeSizeIn });
        }
        break;
      }
      case 'deleteRun': {
        if (targetId != null) rm.handleDeleteRun(targetId);
        break;
      }
      case 'viewProfile': {
        if (targetId != null) {
          if (!pageScalePxPerFt) {
            addToast('Calibrate the page scale first to view a profile.', 'warn');
          } else {
            setProfileRunId(targetId);
          }
        }
        break;
      }
      // Fitting/item actions
      case 'removeFitting':
      case 'removeItem': {
        if (targetId != null) im.deleteItem(targetId);
        break;
      }
      // Canvas actions
      case 'startNewRun': {
        if (rm.canAddRun) rm.handleAddRun();
        break;
      }
      case 'editVertex': {
        if (targetId != null && targetData.vertexIndex != null) {
          setEditingVertex({ runId: targetId, vertexIndex: targetData.vertexIndex });
        }
        break;
      }
      case 'moveVertex': {
        if (targetId != null && targetData.vertexIndex != null) {
          rm.startMoveVertex(targetId, targetData.vertexIndex);
        }
        break;
      }
      case 'deleteVertex': {
        if (targetId != null && targetData.vertexIndex != null) {
          history.record();
          rm.deleteVertex(targetId, targetData.vertexIndex);
        }
        break;
      }
      case 'addVertexHere': {
        if (targetId != null && targetData.segmentIndex != null && targetData.pdfPoint) {
          history.record();
          rm.addVertexOnSegment(targetId, targetData.segmentIndex, targetData.pdfPoint);
        }
        break;
      }
      case 'startRunFromHere': {
        // Start a new run from a shared junction node.
        // Auto-creates a node if the vertex isn't already linked to one.
        if (targetType === 'vertex' && targetId != null && targetData.vertexIndex != null) {
          const run = rm.pageRuns.find((r) => r.id === targetId);
          const vtx = run?.points[targetData.vertexIndex];
          if (vtx?.nodeId) {
            rm.startNewRunFromNode(vtx.nodeId);
          } else if (run && vtx) {
            // Auto-promote to a node (mutates the vertex's node link in DB)
            history.record();
            nm.createNode(
              { x: vtx.x, y: vtx.y },
              run.pdfPage,
              { invertElev: vtx.invertElev ?? null, rimElev: vtx.rimElev ?? null, structureType: vtx.structureType ?? null },
            ).then((node) => {
              // Link the existing vertex to the new node in DB
              window.api.updateTakeoffPoint({
                runId: targetId!, sortOrder: targetData.vertexIndex!,
                invertElev: vtx.invertElev ?? null, rimElev: vtx.rimElev ?? null,
                structureType: vtx.structureType ?? null, nodeId: node.id,
              }).catch(reportSaveError('vertex'));
              // Start the new run from that node
              rm.startNewRunFromNode(node.id);
            }).catch(reportSaveError('junction node'));
          }
        } else if (targetType === 'fitting' && targetId != null) {
          // For fittings: continue the existing run from its end. The run
          // already has a positive ID, so points added while drawing won't
          // be recorded at finish — capture the pre-continue state here.
          const item = im.pageItems.find((i) => i.id === targetId);
          if (item?.nearRunId) {
            history.record();
            rm.continueRun(item.nearRunId);
          }
        }
        break;
      }
      case 'editFitting':
      case 'editItem': {
        if (targetId != null) {
          const item = im.pageItems.find((i) => i.id === targetId);
          if (item) {
            setPendingItemPlacement({
              runId: item.nearRunId,
              point: { x: item.xPx, y: item.yPx },
              pipeSizeIn: undefined,
            });
            editingItemIdRef.current = targetId;
          }
        }
        break;
      }
      case 'duplicateItem': {
        if (targetId != null) {
          history.record();
          im.duplicateItem(targetId);
        }
        break;
      }
      // Area actions
      case 'editArea': {
        if (targetId != null) am.handleEditArea(targetId);
        break;
      }
      case 'deleteArea': {
        if (targetId != null) am.handleDeleteArea(targetId);
        break;
      }
      case 'addArea': {
        if (!rm.isDrawing && !am.isDrawing && !calibrating) am.handleAddArea();
        break;
      }
      // Annotation actions
      case 'editAnnotationText': {
        if (targetId != null) {
          const ann = anm.getById(targetId);
          if (ann) {
            setEditingAnnotationId(targetId);
            setAnnotationText(ann.text);
          }
        }
        break;
      }
      case 'deleteAnnotation': {
        if (targetId != null) {
          history.record();
          anm.deleteAnnotation(targetId);
        }
        break;
      }
      case 'addCountItem': {
        // Open item picker for canvas-level placement (no run association)
        setPendingItemPlacement({
          runId: null,
          point: targetData.pdfPoint ?? { x: 0, y: 0 },
          pipeSizeIn: undefined,
        });
        break;
      }
      default:
        break;
    }
  }, [contextMenu, rm, im, am, anm, calibrating, history, nm, pageScalePxPerFt, addToast]);

  // Material selected from picker -- place item at the stored location or update existing
  const handleItemPickerSelect = useCallback((material: { id: number; name: string }) => {
    if (!pendingItemPlacement) return;

    history.record();
    if (editingItemIdRef.current != null) {
      // Update existing item's material
      im.updateItem(editingItemIdRef.current, material);
      editingItemIdRef.current = null;
    } else {
      im.addItemAtPoint(material, pendingItemPlacement.point, pageNum, pendingItemPlacement.runId);
    }

    setPendingItemPlacement(null);
    setSummaryTab('items');
  }, [pendingItemPlacement, im, pageNum, history]);

  // Overlay mode: calibration > drawing (run, area, wall, or annotation)
  const overlayMode = calibrating ? calibration.overlayMode
    : (am.isDrawing || wm.isDrawing || anm.isDrawing) ? 'draw' : rm.overlayMode;

  const zoomPercent = Math.round(scale * 100);
  const noOtherTool = !anm.isDrawing && !selectMode && !wm.isDrawing;
  const canAddRun = rm.canAddRun && !am.isDrawing && noOtherTool && !!pageScalePxPerFt;
  const canAddArea = !calibrating && !rm.isDrawing && !am.isDrawing && noOtherTool && !!pageScalePxPerFt;
  const canAddWall = !calibrating && !rm.isDrawing && !am.isDrawing && !anm.isDrawing && !selectMode && !!pageScalePxPerFt;
  const canAnnotate = !calibrating && !rm.isDrawing && !am.isDrawing && !wm.isDrawing && !selectMode;
  const canSelect = !calibrating && !rm.isDrawing && !am.isDrawing && !wm.isDrawing && !anm.isDrawing;
  const showPanel = rm.runs.length > 0 || rm.isDrawing || im.items.length > 0
    || am.areas.length > 0 || am.isDrawing || wm.walls.length > 0 || wm.isDrawing;
  const hasTakeoffData = rm.runs.some((r) => r.points.length >= 2) || im.items.length > 0
    || am.areas.some((a) => a.points.length >= 3);

  // Layer visibility filtering (overlay only — summary lists stay complete).
  // The shape being drawn is always visible regardless of layer state.
  const visibleRuns = useMemo(
    () => rm.pageRuns.filter((r) => r.id === rm.activeRunId || !hiddenLayers.has(r.utilityType)),
    [rm.pageRuns, rm.activeRunId, hiddenLayers],
  );
  const visibleItems = useMemo(
    () => (hiddenLayers.has('items') ? [] : im.pageItems),
    [im.pageItems, hiddenLayers],
  );
  const visibleAreas = useMemo(
    () => am.pageAreas.filter((a) => a.id === am.activeAreaId || !hiddenLayers.has('areas')),
    [am.pageAreas, am.activeAreaId, hiddenLayers],
  );
  const visibleAnnotations = useMemo(
    () => (hiddenLayers.has('annotations') ? [] : anm.pageAnnotations),
    [anm.pageAnnotations, hiddenLayers],
  );
  const visibleWalls = useMemo(
    () => wm.pageWalls.filter((w) => w.id === wm.activeWallId || !hiddenLayers.has('walls')),
    [wm.pageWalls, wm.activeWallId, hiddenLayers],
  );

  useEffect(() => {
    if (rm.isDrawing) setSummaryTab('runs');
  }, [rm.isDrawing]);

  useEffect(() => {
    if (am.isDrawing) setSummaryTab('areas');
  }, [am.isDrawing]);

  useEffect(() => {
    if (wm.isDrawing) setSummaryTab('walls');
  }, [wm.isDrawing]);

  // Close context menu when page changes
  useEffect(() => { setContextMenu(null); }, [pageNum, scale]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(true);

      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === ' ') {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }

      if (e.key === 'Escape') {
        if (contextMenu) { setContextMenu(null); return; }
        if (rm.interactionMode === 'moveVertex') { rm.cancelMoveVertex(); return; }
        if (pendingItemPlacement) { setPendingItemPlacement(null); return; }
        if (rm.isDrawing) { finishActiveRun(); return; }
        if (am.isDrawing) { finishActiveArea(); return; }
        if (wm.isDrawing) { finishActiveWall(); return; }
        if (anm.isDrawing) { anm.cancelAnnotation(); return; }
        if (pendingElev) { setPendingElev(null); return; }
        if (captureElev) { setCaptureElev(false); return; }
        if (selectMode) { exitSelectMode(); return; }
      }

      // Undo/redo: while drawing, Ctrl+Z removes the last placed point;
      // otherwise it walks the history stack
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (rm.isDrawing) { if (!e.shiftKey) rm.undoLastPoint(); return; }
        if (am.isDrawing) { if (!e.shiftKey) am.undoLastPoint(); return; }
        if (wm.isDrawing) { if (!e.shiftKey) wm.undoLastPoint(); return; }
        if (e.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        if (!rm.isDrawing && !am.isDrawing && !wm.isDrawing) history.redo();
        return;
      }

      // Page nav is blocked mid-draw — see prevPage/nextPage.
      const lockPage = rm.isDrawing || am.isDrawing || wm.isDrawing || anm.isDrawing;
      switch (e.key) {
        case 'ArrowLeft': if (!lockPage) setPageNum((p) => Math.max(1, p - 1)); break;
        case 'ArrowRight': if (!lockPage) setPageNum((p) => Math.min(totalPages, p + 1)); break;
        case '=': case '+': setScale((s) => Math.min(MAX_SCALE, s + 0.1)); break;
        case '-': setScale((s) => Math.max(MIN_SCALE, s - 0.1)); break;
        case '0':
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); handleFitToWidth(); }
          break;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false);
      if (e.key === 'Shift') setShiftHeld(false);
    };
    // Alt-tabbing away mid-hold swallows the keyup, which would strand the
    // canvas in pan mode (overlay inert, clicks dead) until the key is tapped
    // again. Drop both modifiers whenever focus leaves.
    const handleBlur = () => { setSpaceHeld(false); setShiftHeld(false); };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [totalPages, handleFitToWidth, rm, am, wm, anm, selectMode, exitSelectMode, history, finishActiveRun, finishActiveArea, finishActiveWall, pendingItemPlacement, contextMenu, captureElev, pendingElev]);

  const scaleDisplay = pageScalePxPerFt ? formatScale(pageScalePxPerFt, system) : null;
  const anyDrawing = rm.isDrawing || am.isDrawing || wm.isDrawing;
  const toolbarProps = {
    onBack: handleBack,
    onLoadPlan: handleLoadPlan, loading, pageNum, totalPages, onPrevPage: prevPage,
    onNextPage: nextPage, onSetPage: goToPage, zoomPercent,
    onZoomIn: zoomIn, onZoomOut: zoomOut, onFitToWidth: handleFitToWidth, calibrating,
    onToggleCalibrate: () => setCalibrating(!calibrating), canCalibrate: true,
    scaleDisplay, canAddRun, onAddRun: rm.handleAddRun, isDrawing: rm.isDrawing,
    canAddArea, onAddArea: am.handleAddArea, isDrawingArea: am.isDrawing,
    canAddWall, onAddWall: wm.handleAddWall, isDrawingWall: wm.isDrawing,
    canAnnotate, onStartAnnotation: handleStartAnnotation, isAnnotating: anm.isDrawing,
    canCaptureElev: totalPages > 0,
    captureElev,
    onToggleCaptureElev: () => setCaptureElev((v) => !v),
    surfacePointCount: sm.points.length,
    showHeatmap,
    onToggleHeatmap: () => setShowHeatmap((v) => !v),
    canSendEarthwork: am.areas.some((a) => a.gradeMode != null),
    onSendEarthworkToBid: handleSendEarthworkToBid,
    selectMode, onToggleSelectMode: () => (selectMode ? exitSelectMode() : setSelectMode(true)),
    canSelect,
    onRotatePage: handleRotatePage,
    canRotate: !calibrating && !anyDrawing,
    canUndo: history.canUndo && !anyDrawing && !anm.isDrawing && !calibrating,
    canRedo: history.canRedo && !anyDrawing && !anm.isDrawing && !calibrating,
    onUndo: history.undo, onRedo: history.redo,
    hiddenLayers, onToggleLayer: toggleLayer,
    canExport: hasTakeoffData, onExportCsv: handleExportCsv,
  };

  const pdfFilename = pdfPath ? pdfPath.split(/[\\/]/).pop() || '' : '';

  // The status bar surfaces the active mode like desktop CAD/takeoff apps do.
  // Every mode below takes over the canvas, so each one repeats the hold-Space
  // escape hatch — otherwise the view reads as locked mid-draw.
  let statusHint: React.ReactNode = 'Ready';
  let statusHintActive = false;
  if (calibrating) {
    statusHint = 'Calibrating scale: click two points a known distance apart · hold Space to pan';
    statusHintActive = true;
  } else if (rm.isDrawing || am.isDrawing) {
    statusHint = 'Drawing: click to place points · hold Shift for straight lines · hold Space to pan · right-click to undo · Esc to finish';
    statusHintActive = true;
  } else if (anm.isDrawing) {
    statusHint = 'Markup: click to place · hold Space to pan · Esc to cancel';
    statusHintActive = true;
  } else if (selectMode) {
    statusHint = 'Select: drag a rectangle around objects · hold Space to pan · Esc to exit';
    statusHintActive = true;
  } else if (captureElev) {
    statusHint = 'Capturing existing grade — click the plan to drop a spot elevation · hold Space to pan · Esc to finish';
    statusHintActive = true;
  } else if (!pageScalePxPerFt) {
    statusHint = <span className="tk-status-warn">Page not calibrated. Use the Scale tool to start measuring.</span>;
  } else if (rm.pageRuns.length > 0 || am.pageAreas.length > 0 || im.pageItems.length > 0) {
    statusHint = 'Ready: drag a vertex or symbol to adjust · right-click shapes for options';
  }

  if (!pdfData) return (
    <div className="tk-workspace">
      <div className="tk-toolbar">
        <button className="tk-btn" onClick={onBack} title="Back to Job">
          <ArrowLeft size={16} strokeWidth={1.8} />
          <span>Back to Job</span>
        </button>
        <div className="tk-sep" />
        <span className="tk-readout" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Plan Takeoff</span>
      </div>
      <div className="tk-empty-stage">
        <div className="tk-empty-card">
          <FileText size={40} strokeWidth={1.2} color="var(--text-muted)" />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
              {loading ? 'Loading plan…' : 'No plan loaded'}
            </div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              {loading ? 'Reading PDF data' : 'Open a plan sheet PDF to start measuring pipe runs, areas, and counts.'}
            </div>
          </div>
          {!loading && (
            <button className="btn btn-primary" onClick={handleLoadPlan}>
              Open Plan PDF
            </button>
          )}
        </div>
      </div>
      <div className="tk-statusbar">
        <span className="tk-status-hint">No document</span>
      </div>
    </div>
  );

  return (
    <div className="tk-workspace">
      <TakeoffToolbar {...toolbarProps} />

      {loadError && (
        <div style={{ padding: '10px 16px', background: 'rgba(239,68,68,0.1)',
          color: 'var(--danger, #ef4444)', fontSize: 13, textAlign: 'center' }}>
          Could not read this PDF. The file may be damaged or password-protected.
        </div>
      )}

      {/* Viewer + summary panel */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <div ref={viewerWrapRef} onClick={handleViewerClick} onContextMenu={handleContextMenu}
          onMouseDown={handleMarqueeMouseDown} onMouseMove={handleMarqueeMouseMove}
          onMouseUp={handleMarqueeMouseUp}
          style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative', overflow: 'hidden',
            cursor: (selectMode || captureElev) ? 'crosshair' : undefined }}>
          <PdfViewer
            pdfData={pdfData}
            pageNumber={pageNum}
            scale={scale}
            rotation={pageRotation}
            resetPanKey={resetPanKey}
            panEnabled={(!calibrating && !rm.isDrawing && !am.isDrawing && !wm.isDrawing && !anm.isDrawing && !selectMode && !captureElev) || spaceHeld}
            onViewportChange={setViewport}
            onDocLoaded={handleDocLoaded}
            onPageSizeKnown={handlePageSizeKnown}
            onScaleChange={setScale}
          />
          <DrawingOverlay
            pageWidth={pageSizeRef.current.width}
            pageHeight={pageSizeRef.current.height}
            panX={viewport.panX}
            panY={viewport.panY}
            cssZoom={viewport.cssZoom}
            renderedScale={viewport.renderedScale}
            scale={scale}
            rotation={pageRotation}
            mode={overlayMode}
            onPointClick={handleOverlayPointClick}
            runs={visibleRuns}
            activeRunId={rm.activeRunId}
            selectedRunId={rm.selectedRunId}
            onRunSelect={handleRunSelect}
            mousePosition={am.isDrawing ? am.mousePos : wm.isDrawing ? wm.mousePos : rm.mousePos}
            scalePxPerFt={pageScalePxPerFt}
            onMouseMove={handleOverlayMouseMove}
            spaceHeld={spaceHeld}
            items={visibleItems}
            selectedItemId={im.selectedItemId}
            onItemSelect={handleItemSelect}
            onVertexContextMenu={handleVertexContextMenu}
            onSegmentContextMenu={handleSegmentContextMenu}
            onItemContextMenu={handleItemContextMenu}
            movingVertex={rm.movingVertex}
            movePreviewPos={rm.movePreviewPos}
            snapNodeId={rm.snapNodeId}
            nodes={nm.pageNodes}
            areas={visibleAreas}
            activeAreaId={am.activeAreaId}
            selectedAreaId={am.selectedAreaId}
            onAreaSelect={handleAreaSelect}
            onAreaContextMenu={handleAreaContextMenu}
            annotations={visibleAnnotations}
            onAnnotationContextMenu={handleAnnotationContextMenu}
            annotationPreview={anm.pendingKind && anm.pendingKind !== 'text' && anm.startPoint && anm.mousePos
              ? { kind: anm.pendingKind, start: anm.startPoint, mouse: anm.mousePos }
              : null}
            multiSelected={multiSelected}
            marqueeRect={marqueeRect}
            dragEnabled={!calibrating && !rm.isDrawing && !am.isDrawing && !wm.isDrawing && !anm.isDrawing
              && !selectMode && !spaceHeld && rm.interactionMode === 'normal'}
            onRunVertexDrag={handleRunVertexDrag}
            onAreaVertexDrag={handleAreaVertexDrag}
            onItemDrag={handleItemDrag}
          >
            {calibration.svgContent}
            <SurfaceOverlay
              points={pageSurfacePoints}
              areas={visibleAreas}
              scalePxPerFt={pageScalePxPerFt}
              showHeatmap={showHeatmap}
              showPoints
            />
            <WallOverlay
              walls={visibleWalls}
              activeWallId={wm.activeWallId}
              selectedWallId={wm.selectedWallId}
              mousePosition={wm.isDrawing ? wm.mousePos : null}
              scalePxPerFt={pageScalePxPerFt}
              interactive={!calibrating && !anyDrawing && !selectMode}
              onSelect={handleWallSelect}
            />
          </DrawingOverlay>
          {calibration.panelContent}
          {contextMenu && (
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              items={getMenuItems(contextMenu.targetType)}
              onAction={handleContextMenuAction}
              onClose={closeContextMenu}
            />
          )}
          {/* Multi-select action bar */}
          {multiSelectedCount > 0 && (
            <div style={{
              position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
              background: 'var(--bg-secondary)', border: '1px solid var(--border)',
              borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', zIndex: 700,
            }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                {multiSelectedCount} selected
              </span>
              {multiSelected!.runs.size > 0 && (
                <select className="form-control" style={{ width: 150, fontSize: 12, padding: '3px 6px' }}
                  value="" onChange={(e) => { if (e.target.value) handleBulkSetUtility(e.target.value as UtilityType); }}>
                  <option value="">Set utility type...</option>
                  <option value="sanitary">Sanitary Sewer</option>
                  <option value="storm">Storm Drain</option>
                  <option value="water">Water</option>
                  <option value="fiber">Fiber / Conduit</option>
                  <option value="other">Other</option>
                </select>
              )}
              <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}>Delete</button>
              <button className="btn btn-secondary btn-sm" onClick={clearMultiSelection}>Clear</button>
            </div>
          )}
        </div>

        {showPanel && pageScalePxPerFt && (
          <SummaryPanel
            runs={rm.pageRuns}
            allRuns={rm.runs}
            activeRunId={rm.activeRunId}
            selectedRunId={rm.selectedRunId}
            scalePxPerFt={pageScalePxPerFt}
            pageNumber={pageNum}
            onSelectRun={handleRunSelect}
            onEditRun={rm.handleEditRun}
            onDeleteRun={rm.handleDeleteRun}
            onSendToProfiles={() => setShowSendConfirm(true)}
            onSendItemsToBid={() => setShowSendItemsConfirm(true)}
            items={im.pageItems}
            selectedItemId={im.selectedItemId}
            onSelectItem={handleItemSelect}
            onDeleteItem={im.deleteItem}
            areas={am.pageAreas}
            allAreas={am.areas}
            activeAreaId={am.activeAreaId}
            selectedAreaId={am.selectedAreaId}
            onSelectArea={handleAreaSelect}
            onEditArea={am.handleEditArea}
            onDeleteArea={am.handleDeleteArea}
            onSendAreasToBid={() => setShowSendAreasConfirm(true)}
            walls={wm.pageWalls}
            allWalls={wm.walls}
            activeWallId={wm.activeWallId}
            selectedWallId={wm.selectedWallId}
            onSelectWall={handleWallSelect}
            onEditWall={wm.handleEditWall}
            onDeleteWall={wm.handleDeleteWall}
            onSendWallsToBid={() => setShowSendWallsConfirm(true)}
            activeTab={summaryTab}
            onTabChange={setSummaryTab}
          />
        )}
      </div>

      {/* Status bar — mode hints and document readouts */}
      <div className="tk-statusbar">
        <span className={`tk-status-hint${statusHintActive ? ' tk-status-hint-active' : ''}`}>
          {statusHint}
        </span>
        <span
          className={`tk-status-cell${spaceHeld ? ' tk-status-cell-active' : ''}`}
          title="Hold Space and drag to pan the plan — works while drawing, calibrating, or placing markup"
        >
          <Hand size={11} strokeWidth={2} />
          {spaceHeld ? 'Panning — drag to move' : 'Space + drag to pan'}
        </span>
        <span className="tk-status-cell" title="Plan scale">
          <Ruler size={11} strokeWidth={2} />
          {scaleDisplay ?? 'Not calibrated'}
        </span>
        <span className="tk-status-cell" title="Current page">
          Page {pageNum} of {totalPages || '—'}
        </span>
        <span className="tk-status-cell" title="Zoom level">{zoomPercent}%</span>
        {pdfFilename && (
          <span className="tk-status-cell" title={pdfPath ?? undefined}
            style={{ maxWidth: 260, overflow: 'hidden' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{pdfFilename}</span>
          </span>
        )}
      </div>

      {showSendConfirm && (
        <ConfirmDialog
          message={`Send ${rm.runs.filter((r) => r.points.length >= 2).length} runs to Trench Profiles? You can review and edit them on the job page before converting to a bid.`}
          onYes={handleSendToProfiles}
          onNo={() => setShowSendConfirm(false)}
          yesLabel="Send"
          variant="neutral"
        />
      )}

      {rm.showConfigModal && (
        <TrenchConfigModal
          onConfirm={(config) => {
            // Editing an existing run mutates it; creating a new one doesn't
            // touch persisted state until the run is finished
            if (rm.editingConfig) history.record();
            rm.handleConfigConfirm(config);
          }}
          onCancel={rm.handleConfigCancel}
          initialConfig={rm.editingConfig}
          lastRunConfig={rm.lastRunConfig}
        />
      )}

      {am.showConfigModal && (
        <AreaConfigModal
          onConfirm={(config) => {
            if (am.editingConfig) history.record();
            am.handleConfigConfirm(config);
          }}
          onCancel={am.handleConfigCancel}
          initialConfig={am.editingConfig}
          lastAreaConfig={am.lastAreaConfig}
        />
      )}

      {wm.showConfigModal && (
        <WallConfigModal
          onConfirm={(config) => {
            if (wm.editingConfig) history.record();
            wm.handleConfigConfirm(config);
          }}
          onCancel={wm.handleConfigCancel}
          initialConfig={wm.editingConfig}
          lastWallConfig={wm.lastWallConfig}
        />
      )}

      {/* Annotation text modal */}
      {showAnnotationTextModal && (
        <div className="modal-overlay" onClick={dismissOnEscOnly(handleAnnotationTextCancel)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: 12 }}>{editingAnnotationId != null ? 'Edit Note' : 'Add Note'}</h3>
            <div className="form-group">
              <textarea className="form-control" rows={3} value={annotationText} autoFocus
                onChange={(e) => setAnnotationText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAnnotationTextSave();
                }}
                placeholder="Note text (Ctrl+Enter to save)" />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={handleAnnotationTextCancel}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAnnotationTextSave}
                disabled={!annotationText.trim()}>
                {editingAnnotationId != null ? 'Save' : 'Add Note'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showSendAreasConfirm && (
        <ConfirmDialog
          message={`Send ${am.areas.filter((a) => a.points.length >= 3).length} area${am.areas.filter((a) => a.points.length >= 3).length !== 1 ? 's' : ''} to bid? This will create a "Surface Restoration" section with line items grouped by surface type and depth.`}
          onYes={handleSendAreasToBid}
          onNo={() => setShowSendAreasConfirm(false)}
          yesLabel="Send to Bid"
          variant="neutral"
        />
      )}

      {am.pendingDeleteId !== null && (
        <ConfirmDialog
          message={`Delete "${am.areas.find((a) => a.id === am.pendingDeleteId)?.label || 'this area'}"?`}
          onYes={() => { history.record(); am.confirmDelete(); }}
          onNo={am.cancelDelete}
        />
      )}

      {showSendWallsConfirm && (
        <ConfirmDialog
          message={`Send ${wm.walls.filter((w) => w.points.length >= 2).length} wall${wm.walls.filter((w) => w.points.length >= 2).length !== 1 ? 's' : ''} to bid? This will create a "Walls" section grouped by wall config — billed by a linked material/assembly, or as length + members.`}
          onYes={handleSendWallsToBid}
          onNo={() => setShowSendWallsConfirm(false)}
          yesLabel="Send to Bid"
          variant="neutral"
        />
      )}

      {wm.pendingDeleteId !== null && (
        <ConfirmDialog
          message={`Delete "${wm.walls.find((w) => w.id === wm.pendingDeleteId)?.label || 'this wall'}"?`}
          onYes={() => { history.record(); wm.confirmDelete(); }}
          onNo={wm.cancelDelete}
        />
      )}

      {showSendItemsConfirm && (
        <ConfirmDialog
          message={`Send ${im.items.length} item${im.items.length !== 1 ? 's' : ''} to bid? This will create a "Fittings & Structures" section with line items grouped by material.`}
          onYes={handleSendItemsToBid}
          onNo={() => setShowSendItemsConfirm(false)}
          yesLabel="Send to Bid"
          variant="neutral"
        />
      )}

      {rm.pendingDeleteId !== null && (
        <ConfirmDialog
          message={`Delete "${rm.runs.find((r) => r.id === rm.pendingDeleteId)?.label || 'this run'}"?`}
          onYes={() => { history.record(); rm.confirmDelete(); }}
          onNo={rm.cancelDelete}
        />
      )}

      {im.pendingDeleteId !== null && (
        <ConfirmDialog
          message={`Delete "${im.items.find((i) => i.id === im.pendingDeleteId)?.materialName || 'this item'}"?`}
          onYes={() => { history.record(); im.confirmDelete(); }}
          onNo={im.cancelDelete}
        />
      )}

      {pendingItemPlacement && (
        <ItemPickerModal
          items={im.items}
          onSelect={handleItemPickerSelect}
          onCancel={() => { setPendingItemPlacement(null); editingItemIdRef.current = null; }}
          contextPipeSizeIn={pendingItemPlacement.pipeSizeIn}
        />
      )}

      {editingVertex && (() => {
        const run = rm.runs.find((r) => r.id === editingVertex.runId);
        const vertex = run?.points[editingVertex.vertexIndex];
        if (!run || !vertex) return null;
        const node = vertex.nodeId ? nm.getNodeById(vertex.nodeId) ?? null : null;
        return (
          <EditVertexDialog
            vertex={vertex}
            vertexIndex={editingVertex.vertexIndex}
            runLabel={run.label || 'Untitled Run'}
            node={node}
            onSave={(data) => {
              history.record();
              rm.updateVertexElevation(editingVertex.runId, editingVertex.vertexIndex, data);
              if (node && data.label != null) {
                nm.updateNode(node.id, { label: data.label });
              }
              setEditingVertex(null);
            }}
            onClose={() => setEditingVertex(null)}
          />
        );
      })()}

      {pendingElev && (
        <div className="modal-overlay" onClick={dismissOnEscOnly(() => setPendingElev(null))}>
          <div className="modal" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Spot Elevation</h3>
            <div className="form-group">
              <label className="form-label">Existing ground elevation ({unitLabel('ft', system)})</label>
              <input
                className="form-control"
                type="number"
                autoFocus
                value={elevInput}
                step="0.1"
                onChange={(e) => setElevInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') confirmSpotElevation(); }}
                placeholder="e.g. 100.5"
              />
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setPendingElev(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmSpotElevation}>Add Point</button>
            </div>
          </div>
        </div>
      )}

      {profileRunId != null && pageScalePxPerFt && (() => {
        const run = rm.runs.find((r) => r.id === profileRunId);
        if (!run) return null;
        const groundSampler = buildGroundSampler(sm.surface, run.pdfPage);
        return (
          <div className="modal-overlay" onClick={dismissOnEscOnly(() => setProfileRunId(null))}>
            <div className="modal" style={{ maxWidth: 960, width: '92vw' }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>
                  {profileMode === '3d' ? '3D View' : 'Profile'} — {run.label || 'Untitled Run'}
                </h3>
                <div className="flex gap-8" role="group" aria-label="Profile view mode">
                  <button
                    className={`btn btn-sm ${profileMode === '2d' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setProfileMode('2d')}
                  >2D Profile</button>
                  <button
                    className={`btn btn-sm ${profileMode === '3d' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setProfileMode('3d')}
                  >3D View</button>
                </div>
              </div>
              {profileMode === '3d'
                ? (
                  <React.Suspense fallback={<p className="text-muted" style={{ padding: 24 }}>Loading 3D view…</p>}>
                    <Trench3DView run={run} scalePxPerFt={pageScalePxPerFt} groundSampler={groundSampler} />
                  </React.Suspense>
                )
                : <RunProfileView run={run} scalePxPerFt={pageScalePxPerFt} groundSampler={groundSampler} />}
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setProfileRunId(null)}>Close</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
