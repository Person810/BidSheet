import React, { useState, useCallback, useRef, useEffect } from 'react';
import { PdfViewer, MIN_SCALE, MAX_SCALE } from './PdfViewer';
import { DrawingOverlay } from './DrawingOverlay';
import { useScaleCalibration, formatScale } from './ScaleCalibration';
import type { ScaleResult } from './ScaleCalibration';
import { TrenchConfigModal } from './TrenchConfigModal';
import { SummaryPanel } from './SummaryPanel';
import { useRunManager } from './useRunManager';
import { useItemManager } from './useItemManager';
import TakeoffToolbar from './TakeoffToolbar';
import ItemPickerModal from './ItemPickerModal';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { useToastStore } from '../../../stores/toast-store';
import { sendToProfiles } from './sendToProfiles';
import { sendItemsToBid } from './sendItemsToBid';
import type { TakeoffJobSettings, PdfPoint } from './types';

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

  // -- Item placement via right-click on runs --
  const [pendingItemPlacement, setPendingItemPlacement] = useState<{ runId: number; point: PdfPoint; pipeSizeIn?: number } | null>(null);
  const [summaryTab, setSummaryTab] = useState<'runs' | 'items'>('runs');

  const pageSizeRef = useRef({ width: 0, height: 0 });
  const viewerWrapRef = useRef<HTMLDivElement>(null);

  // Calibration hook
  const calibration = useScaleCalibration({
    active: calibrating,
    pageWidth: pageSizeRef.current.width,
    pageHeight: pageSizeRef.current.height,
    onComplete: async (result: ScaleResult) => {
      // Save per-page scale
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
      setCalibrating(false);
    },
    onCancel: () => setCalibrating(false),
  });

  // Run manager hook
  const rm = useRunManager({
    jobId,
    pageNum,
    calibrating,
    calibrationHandlePointClick: calibration.handlePointClick,
  });

  // Item manager hook
  const im = useItemManager({ jobId, pageNum });

  // Send to Trench Profiles / Send Items to Bid
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [showSendItemsConfirm, setShowSendItemsConfirm] = useState(false);
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

  // Load settings on mount
  useEffect(() => {
    window.api.getTakeoffSettings(jobId).then((s: any) => {
      setJobSettings(s || null);
    }).catch(console.error);
  }, [jobId]);

  // Load per-page scale when page changes
  useEffect(() => {
    window.api.getPageScale(jobId, pageNum).then((row: any) => {
      setPageScalePxPerFt(row?.scale_px_per_ft ?? null);
    }).catch(console.error);
  }, [jobId, pageNum]);

  // Auto-load PDF from saved path
  useEffect(() => {
    if (!jobSettings?.pdf_path || pdfData) return;
    setPdfPath(jobSettings.pdf_path);
    setLoading(true);
    window.api.readTakeoffPdf(jobSettings.pdf_path).then((result: any) => {
      if (result?.data) {
        setPdfData(new Uint8Array(result.data));
      }
    }).catch(console.error).finally(() => setLoading(false));
  }, [jobSettings]); // eslint-disable-line react-hooks/exhaustive-deps

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
        window.api.saveTakeoffSettings(settings).catch(console.error);
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

  const handleViewerClick = useCallback((e: React.MouseEvent) => {
    if (rm.isDrawing) return;
    const target = e.target as HTMLElement;
    if (['line', 'circle', 'rect', 'polygon'].includes(target.tagName)) return;
    rm.handleRunSelect(null);
    im.selectItem(null);
  }, [rm, im]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (rm.isDrawing) rm.undoLastPoint();
  }, [rm]);

  // Right-click on a run line or vertex opens the item picker
  const handleRunContextMenu = useCallback((runId: number, point: PdfPoint) => {
    if (rm.isDrawing || calibrating) return;
    const run = rm.pageRuns.find((r) => r.id === runId);
    setPendingItemPlacement({ runId, point, pipeSizeIn: run?.pipeSizeIn });
  }, [rm.isDrawing, rm.pageRuns, calibrating]);

  // Material selected from picker -- place item at the stored location
  const handleItemPickerSelect = useCallback((material: { id: number; name: string }) => {
    if (!pendingItemPlacement) return;
    im.addItemAtPoint(material, pendingItemPlacement.point, pageNum, pendingItemPlacement.runId);
    setPendingItemPlacement(null);
    setSummaryTab('items');
  }, [pendingItemPlacement, im, pageNum]);

  // Overlay mode: calibration > drawing
  const overlayMode = calibrating ? calibration.overlayMode : rm.overlayMode;

  const zoomPercent = Math.round(scale * 100);
  const canAddRun = rm.canAddRun && !!pageScalePxPerFt;
  const showPanel = rm.runs.length > 0 || rm.isDrawing || im.items.length > 0;

  useEffect(() => {
    if (rm.isDrawing) setSummaryTab('runs');
  }, [rm.isDrawing]);

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
        if (pendingItemPlacement) { setPendingItemPlacement(null); return; }
        if (rm.isDrawing) { rm.finishActiveRun(); return; }
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
  }, [totalPages, handleFitToWidth, rm, pendingItemPlacement]);

  const scaleDisplay = pageScalePxPerFt ? formatScale(pageScalePxPerFt) : null;
  const toolbarProps = {
    onBack,
    onLoadPlan: handleLoadPlan, loading, pageNum, totalPages, onPrevPage: prevPage,
    onNextPage: nextPage, zoomPercent, onFitToWidth: handleFitToWidth, calibrating,
    onToggleCalibrate: () => setCalibrating(!calibrating), canCalibrate: true,
    scaleDisplay, canAddRun, onAddRun: rm.handleAddRun, isDrawing: rm.isDrawing,
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
            resetPanKey={resetPanKey}
            panEnabled={(!calibrating && !rm.isDrawing) || spaceHeld}
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
            mode={overlayMode}
            onPointClick={rm.handlePointClick}
            runs={rm.pageRuns}
            activeRunId={rm.activeRunId}
            selectedRunId={rm.selectedRunId}
            onRunSelect={rm.handleRunSelect}
            mousePosition={rm.mousePos}
            scalePxPerFt={pageScalePxPerFt}
            onMouseMove={rm.handleMouseMove}
            spaceHeld={spaceHeld}
            items={im.pageItems}
            selectedItemId={im.selectedItemId}
            onItemSelect={im.selectItem}
            onRunContextMenu={handleRunContextMenu}
          >
            {calibration.svgContent}
          </DrawingOverlay>
          {calibration.panelContent}
        </div>

        {showPanel && pageScalePxPerFt && (
          <SummaryPanel
            runs={rm.pageRuns}
            allRuns={rm.runs}
            activeRunId={rm.activeRunId}
            selectedRunId={rm.selectedRunId}
            scalePxPerFt={pageScalePxPerFt}
            pageNumber={pageNum}
            onSelectRun={rm.handleRunSelect}
            onEditRun={rm.handleEditRun}
            onDeleteRun={rm.handleDeleteRun}
            onSendToProfiles={() => setShowSendConfirm(true)}
            onSendItemsToBid={() => setShowSendItemsConfirm(true)}
            items={im.pageItems}
            selectedItemId={im.selectedItemId}
            onSelectItem={im.selectItem}
            onDeleteItem={im.deleteItem}
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
          onConfirm={rm.handleConfigConfirm}
          onCancel={rm.handleConfigCancel}
          initialConfig={rm.editingConfig}
          lastRunConfig={rm.lastRunConfig}
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
          message={`Delete "${rm.runs.find((r) => r.id === rm.pendingDeleteId)?.label || 'this run'}"? This cannot be undone.`}
          onYes={rm.confirmDelete}
          onNo={rm.cancelDelete}
        />
      )}

      {im.pendingDeleteId !== null && (
        <ConfirmDialog
          message={`Delete "${im.items.find((i) => i.id === im.pendingDeleteId)?.materialName || 'this item'}"? This cannot be undone.`}
          onYes={im.confirmDelete}
          onNo={im.cancelDelete}
        />
      )}

      {pendingItemPlacement && (
        <ItemPickerModal
          items={im.items}
          onSelect={handleItemPickerSelect}
          onCancel={() => setPendingItemPlacement(null)}
          contextPipeSizeIn={pendingItemPlacement.pipeSizeIn}
        />
      )}
    </div>
  );
}
