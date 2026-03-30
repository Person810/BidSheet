import React, { useState, useCallback, useRef, useEffect } from 'react';
import { PdfViewer, MIN_SCALE, MAX_SCALE } from './PdfViewer';
import { DrawingOverlay } from './DrawingOverlay';
import { useScaleCalibration, formatScale } from './ScaleCalibration';
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

export function PlanTakeoff() {
  // -- Job context --
  const [jobs, setJobs] = useState<any[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
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

  const [showItemPicker, setShowItemPicker] = useState(false);
  const [summaryTab, setSummaryTab] = useState<'runs' | 'items'>('runs');

  const pageSizeRef = useRef({ width: 0, height: 0 });
  const viewerWrapRef = useRef<HTMLDivElement>(null);

  // Calibration hook
  const calibration = useScaleCalibration({
    active: calibrating,
    pageWidth: pageSizeRef.current.width,
    pageHeight: pageSizeRef.current.height,
    existingSettings: jobSettings,
    onComplete: async (result) => {
      if (!selectedJobId) return;
      const settings: TakeoffJobSettings = {
        job_id: selectedJobId,
        pdf_path: pdfPath,
        scale_px_per_ft: result.pxPerFt,
        scale_point1_x: result.point1.x,
        scale_point1_y: result.point1.y,
        scale_point2_x: result.point2.x,
        scale_point2_y: result.point2.y,
        scale_distance_ft: result.distanceFt,
      };
      await window.api.saveTakeoffSettings(settings);
      setJobSettings(settings);
      setCalibrating(false);
    },
    onCancel: () => setCalibrating(false),
  });

  // Run manager hook
  const rm = useRunManager({
    jobId: selectedJobId,
    pageNum,
    calibrating,
    calibrationHandlePointClick: calibration.handlePointClick,
  });

  // Item manager hook
  const im = useItemManager({ jobId: selectedJobId, pageNum });

  // Send to Trench Profiles / Send Items to Bid
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [showSendItemsConfirm, setShowSendItemsConfirm] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  const handleSendToProfiles = useCallback(async () => {
    if (!selectedJobId || !jobSettings?.scale_px_per_ft) return;
    setShowSendConfirm(false);
    try {
      const count = await sendToProfiles(rm.runs, selectedJobId, jobSettings.scale_px_per_ft);
      addToast(`Created ${count} trench profiles. View them on the job page.`, 'success');
    } catch (err) {
      console.error('Send to trench profiles failed:', err);
      addToast('Failed to create trench profiles', 'error');
    }
  }, [selectedJobId, jobSettings, rm.runs, addToast]);

  const handleSendItemsToBid = useCallback(async () => {
    if (!selectedJobId) return;
    setShowSendItemsConfirm(false);
    try {
      const count = await sendItemsToBid(im.items, selectedJobId);
      addToast(`Created ${count} line items in "Fittings & Structures" section.`, 'success');
    } catch (err) {
      console.error('Send items to bid failed:', err);
      addToast('Failed to send items to bid', 'error');
    }
  }, [selectedJobId, im.items, addToast]);

  // Load job list on mount
  useEffect(() => {
    window.api.getJobs().then(setJobs).catch(console.error);
  }, []);

  // Load settings when job changes
  useEffect(() => {
    if (!selectedJobId) { setJobSettings(null); return; }
    window.api.getTakeoffSettings(selectedJobId).then((s: any) => {
      setJobSettings(s || null);
    }).catch(console.error);
  }, [selectedJobId]);

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

        if (selectedJobId) {
          const settings = { ...jobSettings, job_id: selectedJobId, pdf_path: result.filePath };
          window.api.saveTakeoffSettings(settings).catch(console.error);
          setJobSettings(settings as TakeoffJobSettings);
        }
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
    if (rm.isDrawing || im.isPlacing) return;
    const target = e.target as HTMLElement;
    if (['line', 'circle', 'rect', 'polygon'].includes(target.tagName)) return;
    rm.handleRunSelect(null);
    im.selectItem(null);
  }, [rm, im]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (im.isPlacing) { im.cancelPlacing(); return; }
    if (rm.isDrawing) rm.undoLastPoint();
  }, [rm, im]);

  // Unified point click dispatcher
  const handlePointClick = useCallback((point: PdfPoint) => {
    if (calibrating) {
      calibration.handlePointClick(point);
    } else if (im.isPlacing) {
      im.placeItem(point, pageNum);
    } else {
      rm.handlePointClick(point);
    }
  }, [calibrating, calibration, im, rm, pageNum]);

  // Unified mouse move
  const handleOverlayMouseMove = useCallback((point: PdfPoint) => {
    if (im.isPlacing) im.handleMouseMove(point);
    else rm.handleMouseMove(point);
  }, [im, rm]);

  // Overlay mode: calibration > item placement > drawing
  const overlayMode = calibrating
    ? calibration.overlayMode
    : im.isPlacing
      ? im.overlayMode
      : rm.overlayMode;

  const zoomPercent = Math.round(scale * 100);
  const canAddRun = rm.canAddRun && !im.isPlacing && !!jobSettings?.scale_px_per_ft && !!selectedJobId;
  const canPlaceItem = !calibrating && !rm.isDrawing && !im.isPlacing
    && !!jobSettings?.scale_px_per_ft && !!selectedJobId;
  const showPanel = rm.runs.length > 0 || rm.isDrawing || im.items.length > 0 || im.isPlacing;
  useEffect(() => {
    if (rm.isDrawing) setSummaryTab('runs');
    else if (im.isPlacing) setSummaryTab('items');
  }, [rm.isDrawing, im.isPlacing]);

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
        if (im.isPlacing) { im.cancelPlacing(); return; }
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
  }, [totalPages, handleFitToWidth, rm, im]);

  const handleJobChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value ? Number(e.target.value) : null;
    setSelectedJobId(id);
    setCalibrating(false);
  };

  const scaleDisplay = jobSettings?.scale_px_per_ft ? formatScale(jobSettings.scale_px_per_ft) : null;
  const toolbarProps = { jobs, selectedJobId, onJobChange: handleJobChange,
    onLoadPlan: handleLoadPlan, loading, pageNum, totalPages, onPrevPage: prevPage,
    onNextPage: nextPage, zoomPercent, onFitToWidth: handleFitToWidth, calibrating,
    onToggleCalibrate: () => setCalibrating(!calibrating), canCalibrate: !!selectedJobId,
    scaleDisplay, canAddRun, onAddRun: rm.handleAddRun, isDrawing: rm.isDrawing,
    canPlaceItem, onPlaceItem: () => setShowItemPicker(true), isPlacing: im.isPlacing,
    placingMaterialName: im.placingMaterial?.name ?? null, onDonePlacing: im.cancelPlacing,
    pdfFilename: pdfPath ? pdfPath.split(/[\\/]/).pop() || '' : '' };

  if (!pdfData) return (
    <div>
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Plan Takeoff</h2>
        <select className="form-control" style={{ width: 200, fontSize: 13, padding: '4px 8px' }}
          value={selectedJobId ?? ''} onChange={handleJobChange}>
          <option value="">-- Select Job --</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: 'calc(100vh - 160px)', gap: 16 }}>
        <p className="text-muted" style={{ fontSize: 15, marginBottom: 8 }}>
          Load a plan sheet PDF to start measuring pipe runs.
        </p>
        <button className="btn btn-primary" onClick={handleLoadPlan} disabled={loading}>
          {loading ? 'Opening...' : 'Load Plan'}
        </button>
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
            panEnabled={(!calibrating && !rm.isDrawing && !im.isPlacing) || spaceHeld}
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
            onPointClick={handlePointClick}
            runs={rm.pageRuns}
            activeRunId={rm.activeRunId}
            selectedRunId={rm.selectedRunId}
            onRunSelect={rm.handleRunSelect}
            mousePosition={im.isPlacing ? im.mousePos : rm.mousePos}
            scalePxPerFt={jobSettings?.scale_px_per_ft}
            onMouseMove={handleOverlayMouseMove}
            spaceHeld={spaceHeld}
            items={im.pageItems}
            selectedItemId={im.selectedItemId}
            onItemSelect={im.selectItem}
            placingMaterial={im.placingMaterial}
          >
            {calibration.svgContent}
          </DrawingOverlay>
          {calibration.panelContent}
        </div>

        {showPanel && jobSettings?.scale_px_per_ft && (
          <SummaryPanel
            runs={rm.pageRuns}
            allRuns={rm.runs}
            activeRunId={rm.activeRunId}
            selectedRunId={rm.selectedRunId}
            scalePxPerFt={jobSettings.scale_px_per_ft}
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

      {showItemPicker && (
        <ItemPickerModal
          items={im.items}
          onSelect={(material) => {
            setShowItemPicker(false);
            im.startPlacing(material);
          }}
          onCancel={() => setShowItemPicker(false)}
        />
      )}
    </div>
  );
}
