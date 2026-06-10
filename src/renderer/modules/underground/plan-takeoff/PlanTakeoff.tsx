import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { PdfViewer, MIN_SCALE, MAX_SCALE } from './PdfViewer';
import { DrawingOverlay, screenToPdf } from './DrawingOverlay';
import { useScaleCalibration, formatScale } from './ScaleCalibration';
import type { ScaleResult } from './ScaleCalibration';
import { TrenchConfigModal } from './TrenchConfigModal';
import { AreaConfigModal } from './AreaConfigModal';
import { SummaryPanel, type SummaryTab } from './SummaryPanel';
import { useRunManager } from './useRunManager';
import { useItemManager } from './useItemManager';
import { useNodeManager } from './useNodeManager';
import { useAreaManager } from './useAreaManager';
import { useTakeoffHistory } from './useTakeoffHistory';
import TakeoffToolbar, { type LayerKey } from './TakeoffToolbar';
import ItemPickerModal from './ItemPickerModal';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { useToastStore } from '../../../stores/toast-store';
import { sendToProfiles } from './sendToProfiles';
import { sendItemsToBid } from './sendItemsToBid';
import { sendAreasToBid } from './sendAreasToBid';
import { buildTakeoffCsv } from './exportTakeoffCsv';
import { ContextMenu, getMenuItems } from './ContextMenu';
import { EditVertexDialog } from './EditVertexDialog';
import type { TakeoffJobSettings, PdfPoint, ContextMenuState } from './types';

interface PlanTakeoffProps {
  jobId: number;
  onBack: () => void;
}

export function PlanTakeoff({ jobId, onBack }: PlanTakeoffProps) {
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

  // -- Per-page scale --
  const [pageScalePxPerFt, setPageScalePxPerFt] = useState<number | null>(null);

  // -- Per-page rotation --
  const [pageRotation, setPageRotation] = useState(0);

  // -- Context menu --
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editingVertex, setEditingVertex] = useState<{ runId: number; vertexIndex: number } | null>(null);

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

  // -- Undo/redo history --
  // State is read through a ref so record() always sees the latest values
  // without re-creating callbacks on every render.
  const takeoffStateRef = useRef({ runs: rm.runs, items: im.items, nodes: nm.nodes, areas: am.areas });
  takeoffStateRef.current = { runs: rm.runs, items: im.items, nodes: nm.nodes, areas: am.areas };
  const getTakeoffState = useCallback(() => takeoffStateRef.current, []);
  const reloadAll = useCallback(async () => {
    await Promise.all([rm.reload(), im.reload(), nm.reload(), am.reload()]);
  }, [rm.reload, im.reload, nm.reload, am.reload]);
  const history = useTakeoffHistory({ jobId, getState: getTakeoffState, reloadAll });

  // Send to Trench Profiles / Send Items to Bid / Send Areas to Bid
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [showSendItemsConfirm, setShowSendItemsConfirm] = useState(false);
  const [showSendAreasConfirm, setShowSendAreasConfirm] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  const handleSendToProfiles = useCallback(async () => {
    setShowSendConfirm(false);
    try {
      const count = await sendToProfiles(rm.runs, jobId);
      addToast(`Created ${count} trench profiles. View them on the job page.`, 'success');
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
      const count = await sendAreasToBid(am.areas, jobId);
      if (count === 0) {
        addToast('No areas on calibrated pages to send.', 'error');
      } else {
        addToast(`Created ${count} line items in "Surface Restoration" section.`, 'success');
      }
    } catch (err) {
      console.error('Send areas to bid failed:', err);
      addToast('Failed to send areas to bid', 'error');
    }
  }, [jobId, am.areas, addToast]);

  const handleExportCsv = useCallback(async () => {
    try {
      const csv = await buildTakeoffCsv(jobId, rm.runs, im.items, am.areas);
      const result = await window.api.exportTakeoffCsv(jobId, csv);
      if (result?.success) addToast(`Takeoff exported to ${result.path}`, 'success');
    } catch (err) {
      console.error('Takeoff CSV export failed:', err);
      addToast('Failed to export takeoff CSV', 'error');
    }
  }, [jobId, rm.runs, im.items, am.areas, addToast]);

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
      }
    }).finally(() => setLoading(false));
  }, [jobSettings, pdfPath]);

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

        const settings = { ...jobSettings, job_id: jobId, pdf_path: result.filePath };
        window.api.saveTakeoffSettings(settings);
        setJobSettings(settings as TakeoffJobSettings);
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

  const prevPage = useCallback(() => setPageNum((p) => Math.max(1, p - 1)), []);
  const nextPage = useCallback(() => setPageNum((p) => Math.min(totalPages, p + 1)), [totalPages]);
  const handleFitToWidth = useCallback(() => {
    const wrap = viewerWrapRef.current;
    if (!wrap || pageSizeRef.current.width === 0) return;
    const available = wrap.clientWidth - 24;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, available / pageSizeRef.current.width));
    setScale(newScale);
    setResetPanKey((k) => k + 1);
  }, []);

  // Route overlay clicks/moves to whichever tool is active.
  // Calibration and run interactions (move-vertex, run drawing) are handled
  // inside rm.handlePointClick; area drawing is checked first since the run
  // manager would silently ignore those clicks.
  const handleOverlayPointClick = useCallback((point: PdfPoint) => {
    if (!calibrating && am.isDrawing) {
      am.handlePointClick(point);
      return;
    }
    // Confirming a vertex move mutates the run (and possibly a shared node)
    if (!calibrating && rm.interactionMode === 'moveVertex' && rm.movingVertex) {
      history.record();
    }
    rm.handlePointClick(point);
  }, [calibrating, am, rm, history]);

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

  const handleOverlayMouseMove = useCallback((point: PdfPoint) => {
    rm.handleMouseMove(point);
    am.handleMouseMove(point);
  }, [rm, am]);

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

  const handleViewerClick = useCallback((e: React.MouseEvent) => {
    if (rm.isDrawing || am.isDrawing) return;
    const target = e.target as HTMLElement;
    if (['line', 'circle', 'rect', 'polygon'].includes(target.tagName)) return;
    rm.handleRunSelect(null);
    im.selectItem(null);
    am.handleAreaSelect(null);
  }, [rm, im, am]);

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
              });
              // Start the new run from that node
              rm.startNewRunFromNode(node.id);
            });
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
  }, [contextMenu, rm, im, am, calibrating, history, nm]);

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

  // Overlay mode: calibration > drawing (run or area)
  const overlayMode = calibrating ? calibration.overlayMode : am.isDrawing ? 'draw' : rm.overlayMode;

  const zoomPercent = Math.round(scale * 100);
  const canAddRun = rm.canAddRun && !am.isDrawing && !!pageScalePxPerFt;
  const canAddArea = !calibrating && !rm.isDrawing && !am.isDrawing && !!pageScalePxPerFt;
  const showPanel = rm.runs.length > 0 || rm.isDrawing || im.items.length > 0
    || am.areas.length > 0 || am.isDrawing;
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

  useEffect(() => {
    if (rm.isDrawing) setSummaryTab('runs');
  }, [rm.isDrawing]);

  useEffect(() => {
    if (am.isDrawing) setSummaryTab('areas');
  }, [am.isDrawing]);

  // Close context menu when page changes
  useEffect(() => { setContextMenu(null); }, [pageNum, scale]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
      }

      // Undo/redo: while drawing, Ctrl+Z removes the last placed point;
      // otherwise it walks the history stack
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (rm.isDrawing) { if (!e.shiftKey) rm.undoLastPoint(); return; }
        if (am.isDrawing) { if (!e.shiftKey) am.undoLastPoint(); return; }
        if (e.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        if (!rm.isDrawing && !am.isDrawing) history.redo();
        return;
      }

      switch (e.key) {
        case 'ArrowLeft': setPageNum((p) => Math.max(1, p - 1)); break;
        case 'ArrowRight': setPageNum((p) => Math.min(totalPages, p + 1)); break;
        case '=': case '+': setScale((s) => Math.min(MAX_SCALE, s + 0.1)); break;
        case '-': setScale((s) => Math.max(MIN_SCALE, s - 0.1)); break;
        case '0':
          if (e.ctrlKey || e.metaKey) { e.preventDefault(); handleFitToWidth(); }
          break;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [totalPages, handleFitToWidth, rm, am, history, finishActiveRun, finishActiveArea, pendingItemPlacement, contextMenu]);

  const scaleDisplay = pageScalePxPerFt ? formatScale(pageScalePxPerFt) : null;
  const anyDrawing = rm.isDrawing || am.isDrawing;
  const toolbarProps = {
    onBack,
    onLoadPlan: handleLoadPlan, loading, pageNum, totalPages, onPrevPage: prevPage,
    onNextPage: nextPage, zoomPercent, onFitToWidth: handleFitToWidth, calibrating,
    onToggleCalibrate: () => setCalibrating(!calibrating), canCalibrate: true,
    scaleDisplay, canAddRun, onAddRun: rm.handleAddRun, isDrawing: rm.isDrawing,
    canAddArea, onAddArea: am.handleAddArea, isDrawingArea: am.isDrawing,
    onRotatePage: handleRotatePage,
    canRotate: !calibrating && !anyDrawing,
    canUndo: history.canUndo && !anyDrawing && !calibrating,
    canRedo: history.canRedo && !anyDrawing && !calibrating,
    onUndo: history.undo, onRedo: history.redo,
    hiddenLayers, onToggleLayer: toggleLayer,
    canExport: hasTakeoffData, onExportCsv: handleExportCsv,
    pdfFilename: pdfPath ? pdfPath.split(/[\\/]/).pop() || '' : '',
  };

  if (!pdfData) return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-sm btn-secondary" onClick={onBack}>&#8592; Back to Job</button>
        <h2 style={{ margin: 0 }}>Plan Takeoff</h2>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: 'calc(100vh - 160px)', gap: 16 }}>
        <p className="text-muted" style={{ fontSize: 15, marginBottom: 8 }}>
          {loading ? 'Loading plan...' : 'Load a plan sheet PDF to start measuring pipe runs.'}
        </p>
        {!loading && (
          <button className="btn btn-primary" onClick={handleLoadPlan}>
            Load Plan
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 40px)' }}>
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
          style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative', overflow: 'hidden' }}>
          <PdfViewer
            pdfData={pdfData}
            pageNumber={pageNum}
            scale={scale}
            rotation={pageRotation}
            resetPanKey={resetPanKey}
            panEnabled={(!calibrating && !rm.isDrawing && !am.isDrawing) || spaceHeld}
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
            mousePosition={am.isDrawing ? am.mousePos : rm.mousePos}
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
          >
            {calibration.svgContent}
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
            activeTab={summaryTab}
            onTabChange={setSummaryTab}
          />
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
    </div>
  );
}
