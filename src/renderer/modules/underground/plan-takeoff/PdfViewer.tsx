import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { MagnifierLoupe } from './MagnifierLoupe';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 5.0;
const ZOOM_STEP = 0.1;
const RENDER_DEBOUNCE_MS = 300;

/* ---- Supersampling ----
 * Rasterizing a plan sheet at its display size puts hairlines and small text
 * below one pixel, where antialiasing smears them into grey mush — the
 * zoomed-out "blurry PDF" problem. Rendering above display size and letting
 * the browser downscale recovers most of that detail.
 */

/** Device pixels per PDF point we aim to rasterize at. Deliberately just
 *  above 1:1 — the goal is to claw back the zoomed-out case without inflating
 *  bitmaps at high zoom, where a full-page render is already expensive. */
const TARGET_DENSITY = 1.25;
/** Ceiling on the multiplier, so a very low zoom can't ask for a huge bitmap. */
const MAX_SUPERSAMPLE = 2.5;
/** Device-pixel budget for one page bitmap (~24M px ≈ 96 MB at RGBA). */
const MAX_CANVAS_PX = 24_000_000;

/**
 * How much to oversample a page render.
 *
 * `displayScale * dpr` is the density the page would rasterize at natively;
 * anything below TARGET_DENSITY gets scaled up toward it, then clamped so the
 * bitmap stays inside the pixel budget. Returns 1 when the native density is
 * already sufficient (zoomed in), making this a no-op at high zoom.
 */
export function supersampleFactor(
  displayScale: number, dpr: number, pageW: number, pageH: number,
  budgetPx: number = MAX_CANVAS_PX,
): number {
  const density = displayScale * dpr;
  if (!(density > 0) || !(pageW > 0) || !(pageH > 0)) return 1;

  const wanted = Math.min(MAX_SUPERSAMPLE, Math.max(1, TARGET_DENSITY / density));

  // Clamp against the budget: pixels grow with the square of the factor.
  const basePx = pageW * displayScale * dpr * pageH * displayScale * dpr;
  if (basePx <= 0) return wanted;
  const maxByBudget = Math.sqrt(budgetPx / basePx);
  return Math.max(1, Math.min(wanted, maxByBudget));
}

interface PdfViewerProps {
  pdfData: Uint8Array;
  pageNumber: number;
  scale: number;
  /** Extra clockwise rotation in degrees (0/90/180/270) on top of the page's own rotation. */
  rotation?: number;
  /** Increment to reset pan to center (e.g. on fit-to-width). */
  resetPanKey?: number;
  /** When false, mouse-drag panning is disabled (e.g. during calibration). Defaults to true. */
  panEnabled?: boolean;
  /** Show the magnifier loupe following the cursor. */
  loupeActive?: boolean;
  /** Fires when pan/zoom state changes so sibling overlays can stay in sync. */
  onViewportChange?: (info: { panX: number; panY: number; renderedScale: number; cssZoom: number }) => void;
  onDocLoaded: (totalPages: number) => void;
  onPageSizeKnown: (width: number, height: number) => void;
  onScaleChange: (scale: number) => void;
}

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

export function PdfViewer({
  pdfData, pageNumber, scale, rotation = 0, resetPanKey, panEnabled = true,
  loupeActive = false, onViewportChange,
  onDocLoaded, onPageSizeKnown, onScaleChange,
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The scale the visible canvas was last painted at.
  const [renderedScale, setRenderedScale] = useState(scale);
  // Bumped when a document finishes loading so the first render fires even
  // when getDocument outlasts the initial effects (nothing else would
  // trigger a render until the user zoomed or changed pages).
  const [docVersion, setDocVersion] = useState(0);

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
        setDocVersion((v) => v + 1);
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

      // pdf.js rotation is the TOTAL clockwise rotation, so add the page's
      // own rotation to the user-applied one
      const totalRotation = (((page.rotate || 0) + rotation) % 360 + 360) % 360;

      const baseVp = page.getViewport({ scale: 1.0, rotation: totalRotation });
      onPageSizeKnown(baseVp.width, baseVp.height);

      const dpr = window.devicePixelRatio || 1;
      // Display geometry — what the canvas occupies on screen.
      const viewport = page.getViewport({ scale: targetScale, rotation: totalRotation });

      // Raster geometry — may be larger; the browser downscales it into the
      // display box, which is what keeps thin linework legible when zoomed out.
      const ss = supersampleFactor(targetScale, dpr, baseVp.width, baseVp.height);
      const renderVp = ss === 1
        ? viewport
        : page.getViewport({ scale: targetScale * ss, rotation: totalRotation });

      // Render onto an offscreen canvas
      const offscreen = document.createElement('canvas');
      offscreen.width = Math.floor(renderVp.width * dpr);
      offscreen.height = Math.floor(renderVp.height * dpr);

      const offCtx = offscreen.getContext('2d');
      if (!offCtx) return;
      offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const task = page.render({ canvasContext: offCtx, viewport: renderVp });
      renderTaskRef.current = task;
      await task.promise;

      // Swap onto the visible canvas inside a single animation frame
      // so the browser never paints the cleared-but-not-yet-drawn state.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          // Backing store carries the full raster (dpr * supersample); the CSS
          // box stays at display size. The gap between them is the downscale
          // that sharpens thin linework — keep these two independent.
          visibleCanvas.width = offscreen.width;
          visibleCanvas.height = offscreen.height;
          visibleCanvas.style.width = `${viewport.width}px`;
          visibleCanvas.style.height = `${viewport.height}px`;

          const visCtx = visibleCanvas.getContext('2d');
          if (visCtx) visCtx.drawImage(offscreen, 0, 0);

          // Release the offscreen canvas so GC can reclaim its backing memory
          offscreen.width = 0;
          offscreen.height = 0;

          setRenderedScale(targetScale);
          resolve();
        });
      });
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error('PDF render error:', err);
      }
    }
  }, [pageNumber, rotation, onPageSizeKnown]);

  // Page change: render immediately
  useEffect(() => {
    setPanX(0);
    setPanY(0);
    doRender(scale);
  }, [pageNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  // Document arrival: render the current page. The load effect can't call
  // doRender itself — doRender's identity changes with page/rotation and
  // must not retrigger a document load — so it bumps docVersion instead.
  // This is what paints the first page (and fires onPageSizeKnown) when
  // getDocument resolves after the initial effects have already run.
  useEffect(() => {
    if (docVersion > 0) doRender(scale);
  }, [docVersion]); // eslint-disable-line react-hooks/exhaustive-deps

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
    e.stopPropagation(); // prevent double-firing if a parent also has onWheel
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
    if (e.button !== 0 || !panEnabled) return;
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY, panX, panY };
  }, [panX, panY, panEnabled]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setPanX(panStartRef.current.panX + (e.clientX - panStartRef.current.x));
    setPanY(panStartRef.current.panY + (e.clientY - panStartRef.current.y));
  }, [isPanning]);

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  // Notify parent of viewport state changes for overlay synchronization
  useEffect(() => {
    onViewportChange?.({ panX, panY, renderedScale, cssZoom });
  }, [panX, panY, renderedScale, cssZoom, onViewportChange]);

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
        // An active drag still reads as grabbing; otherwise the magnifier
        // owns the cursor while it's on. Point placement keeps its crosshair
        // (set on the overlay) — a zoom cursor's hotspot is too vague to
        // trace a run with.
        cursor: isPanning ? 'grabbing'
          : loupeActive ? 'zoom-in'
            : (panEnabled ? 'grab' : 'default'),
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
      <MagnifierLoupe
        active={loupeActive}
        doc={docRef.current}
        docVersion={docVersion}
        pageNumber={pageNumber}
        rotation={rotation}
        scale={scale}
        panX={panX}
        panY={panY}
        containerRef={containerRef}
      />
    </div>
  );
}
