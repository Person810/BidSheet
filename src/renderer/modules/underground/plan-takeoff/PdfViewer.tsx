import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 5.0;
const ZOOM_STEP = 0.1;
const RENDER_DEBOUNCE_MS = 300;

interface PdfViewerProps {
  pdfData: Uint8Array;
  pageNumber: number;
  scale: number;
  /** Increment to reset pan to center (e.g. on fit-to-width). */
  resetPanKey?: number;
  onDocLoaded: (totalPages: number) => void;
  onPageSizeKnown: (width: number, height: number) => void;
  onScaleChange: (scale: number) => void;
}

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

export function PdfViewer({
  pdfData, pageNumber, scale, resetPanKey, onDocLoaded, onPageSizeKnown, onScaleChange,
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The scale the visible canvas was last painted at.
  const [renderedScale, setRenderedScale] = useState(scale);

  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Load the PDF document when pdfData changes
  useEffect(() => {
    let cancelled = false;

    async function loadDoc() {
      if (docRef.current) {
        docRef.current.destroy();
        docRef.current = null;
      }
      try {
        const copy = new Uint8Array(pdfData);
        const doc = await pdfjsLib.getDocument({
          data: copy,
          useSystemFonts: true,
        }).promise;
        if (cancelled) { doc.destroy(); return; }
        docRef.current = doc;
        onDocLoaded(doc.numPages);
      } catch (err) {
        console.error('Failed to load PDF:', err);
        onDocLoaded(0); // signal failure
      }
    }

    loadDoc();
    return () => { cancelled = true; };
  }, [pdfData, onDocLoaded]);

  // Render to an OFFSCREEN canvas, then copy to the visible one.
  // The visible canvas never clears, so there's zero flicker.
  const doRender = useCallback(async (targetScale: number) => {
    const doc = docRef.current;
    const visibleCanvas = canvasRef.current;
    if (!doc || !visibleCanvas) return;

    // Cancel any in-progress render
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    try {
      const page = await doc.getPage(pageNumber);

      const baseVp = page.getViewport({ scale: 1.0 });
      onPageSizeKnown(baseVp.width, baseVp.height);

      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: targetScale });

      // Render onto an offscreen canvas
      const offscreen = document.createElement('canvas');
      offscreen.width = Math.floor(viewport.width * dpr);
      offscreen.height = Math.floor(viewport.height * dpr);

      const offCtx = offscreen.getContext('2d');
      if (!offCtx) return;
      offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const task = page.render({ canvasContext: offCtx, viewport });
      renderTaskRef.current = task;
      await task.promise;

      // Swap onto the visible canvas inside a single animation frame
      // so the browser never paints the cleared-but-not-yet-drawn state.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          visibleCanvas.width = offscreen.width;
          visibleCanvas.height = offscreen.height;
          visibleCanvas.style.width = `${viewport.width}px`;
          visibleCanvas.style.height = `${viewport.height}px`;

          const visCtx = visibleCanvas.getContext('2d');
          if (visCtx) visCtx.drawImage(offscreen, 0, 0);

          setRenderedScale(targetScale);
          resolve();
        });
      });
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error('PDF render error:', err);
      }
    }
  }, [pageNumber, onPageSizeKnown]);

  // Page change: render immediately
  useEffect(() => {
    setPanX(0);
    setPanY(0);
    doRender(scale);
  }, [pageNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  // External reset-pan signal (e.g. fit-to-width)
  useEffect(() => {
    if (resetPanKey !== undefined && resetPanKey > 0) {
      setPanX(0);
      setPanY(0);
    }
  }, [resetPanKey]);

  // Scale change: debounced re-render (CSS transform covers the gap)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doRender(scale), RENDER_DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [scale, doRender]);

  // CSS zoom bridges the gap until the debounced render completes
  const cssZoom = renderedScale > 0 ? scale / renderedScale : 1;

  // Mouse wheel zoom -- focal point follows the cursor
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const newScale = clampScale(scale + (e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP));
    if (newScale === scale) return;

    const container = containerRef.current;
    if (!container) { onScaleChange(newScale); return; }

    const rect = container.getBoundingClientRect();
    // Mouse offset from the container center (which is the flex-centered
    // canvas origin when panX/panY are 0).
    const dx = (e.clientX - rect.left) - rect.width / 2;
    const dy = (e.clientY - rect.top) - rect.height / 2;
    const ratio = newScale / scale;

    setPanX(dx * (1 - ratio) + panX * ratio);
    setPanY(dy * (1 - ratio) + panY * ratio);
    onScaleChange(newScale);
  }, [scale, panX, panY, onScaleChange]);

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY, panX, panY };
  }, [panX, panY]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setPanX(panStartRef.current.panX + (e.clientX - panStartRef.current.x));
    setPanY(panStartRef.current.panY + (e.clientY - panStartRef.current.y));
  }, [isPanning]);

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  // Cleanup on unmount: destroy the PDF document and cancel pending work
  useEffect(() => {
    return () => {
      if (renderTaskRef.current) renderTaskRef.current.cancel();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (docRef.current) { docRef.current.destroy(); docRef.current = null; }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{
        flex: 1, overflow: 'hidden',
        cursor: isPanning ? 'grabbing' : 'grab',
        background: 'var(--bg-secondary, #f0f0f0)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative', userSelect: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          transform: `translate(${panX}px, ${panY}px) scale(${cssZoom})`,
          transformOrigin: 'center center',
          boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
        }}
      />
    </div>
  );
}
