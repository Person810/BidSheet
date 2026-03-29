import React, { useState, useCallback, useRef, useEffect } from 'react';
import { PdfViewer, MIN_SCALE, MAX_SCALE } from './PdfViewer';

export function PlanTakeoff() {
  const [pdfPath, setPdfPath] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(false);
  const [resetPanKey, setResetPanKey] = useState(0);

  // Track the PDF page's base size (at scale 1.0) for fit-to-width
  const pageSizeRef = useRef({ width: 0, height: 0 });
  const viewerWrapRef = useRef<HTMLDivElement>(null);

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
      }
    } catch (err) {
      console.error('Failed to open PDF:', err);
    } finally {
      setLoading(false);
    }
  };

  const [loadError, setLoadError] = useState(false);

  const handleDocLoaded = useCallback((pages: number) => {
    setTotalPages(pages);
    setLoadError(pages === 0);
  }, []);

  const handlePageSizeKnown = useCallback((w: number, h: number) => {
    pageSizeRef.current = { width: w, height: h };
  }, []);

  const prevPage = () => setPageNum((p) => Math.max(1, p - 1));
  const nextPage = () => setPageNum((p) => Math.min(totalPages, p + 1));

  const handleFitToWidth = useCallback(() => {
    const wrap = viewerWrapRef.current;
    if (!wrap || pageSizeRef.current.width === 0) return;
    const available = wrap.clientWidth - 24;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, available / pageSizeRef.current.width));
    setScale(newScale);
    setResetPanKey((k) => k + 1);
  }, []);

  const zoomPercent = Math.round(scale * 100);

  // Keyboard shortcuts: arrows for pages, +/- for zoom, Ctrl+0 for fit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case 'ArrowLeft':
          setPageNum((p) => Math.max(1, p - 1));
          break;
        case 'ArrowRight':
          setPageNum((p) => Math.min(totalPages, p + 1));
          break;
        case '=':
        case '+':
          setScale((s) => Math.min(MAX_SCALE, s + 0.1));
          break;
        case '-':
          setScale((s) => Math.max(MIN_SCALE, s - 0.1));
          break;
        case '0':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            handleFitToWidth();
          }
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [totalPages, handleFitToWidth]);

  // Empty state -- no PDF loaded yet
  if (!pdfData) {
    return (
      <div>
        <div className="page-header">
          <h2>Plan Takeoff</h2>
        </div>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: 'calc(100vh - 160px)', gap: 16,
        }}>
          <p className="text-muted" style={{ fontSize: 15, marginBottom: 8 }}>
            Load a plan sheet PDF to start measuring pipe runs.
          </p>
          <button className="btn btn-primary" onClick={handleLoadPlan} disabled={loading}>
            {loading ? 'Opening...' : 'Load Plan'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 40px)' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        borderBottom: '1px solid var(--border-color, #e0e0e0)',
        background: 'var(--bg-primary, #fff)', flexShrink: 0,
      }}>
        <button className="btn btn-secondary btn-sm" onClick={handleLoadPlan} disabled={loading}>
          Load Plan
        </button>

        <Separator />

        {/* Page navigation */}
        <button className="btn btn-secondary btn-sm" onClick={prevPage}
          disabled={pageNum <= 1} title="Previous page">&larr;</button>
        <span style={{ fontSize: 13, minWidth: 80, textAlign: 'center', whiteSpace: 'nowrap' }}>
          Page {pageNum} of {totalPages || '...'}
        </span>
        <button className="btn btn-secondary btn-sm" onClick={nextPage}
          disabled={pageNum >= totalPages} title="Next page">&rarr;</button>

        <Separator />

        {/* Zoom */}
        <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 48, textAlign: 'center' }}>
          {zoomPercent}%
        </span>
        <button className="btn btn-secondary btn-sm" onClick={handleFitToWidth} title="Fit to width">
          Fit
        </button>

        <div style={{ flex: 1 }} />

        {/* File name */}
        <span className="text-muted" style={{ fontSize: 11, maxWidth: 300, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl' }}>
          {pdfPath ? pdfPath.split(/[\\/]/).pop() : ''}
        </span>
      </div>

      {/* Error banner */}
      {loadError && (
        <div style={{ padding: '10px 16px', background: 'rgba(239,68,68,0.1)',
          color: 'var(--danger, #ef4444)', fontSize: 13, textAlign: 'center' }}>
          Could not read this PDF. The file may be damaged or password-protected.
        </div>
      )}

      {/* Viewer area */}
      <div ref={viewerWrapRef} style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <PdfViewer
          pdfData={pdfData}
          pageNumber={pageNum}
          scale={scale}
          resetPanKey={resetPanKey}
          onDocLoaded={handleDocLoaded}
          onPageSizeKnown={handlePageSizeKnown}
          onScaleChange={setScale}
        />
      </div>
    </div>
  );
}

function Separator() {
  return <div style={{ width: 1, height: 20, background: 'var(--border-color, #ddd)', margin: '0 4px' }} />;
}
