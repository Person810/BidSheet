import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

/* ---- Constants ---- */

/** Loupe window size in CSS px. */
const LOUPE_W = 280;
const LOUPE_H = 190;
/** Gap between the cursor and the loupe's near corner. */
const CURSOR_GAP = 22;

/** Magnification relative to the current display scale. */
const ZOOM_FACTOR = 4;
/** Absolute render-scale bounds, so the loupe stays useful when zoomed far
 *  out and doesn't rasterize a huge tile when already zoomed in. */
const MIN_LOUPE_SCALE = 1.5;
const MAX_LOUPE_SCALE = 6;

/** The cached tile covers this multiple of the loupe window in each axis, so
 *  small cursor moves redraw from cache instead of re-rasterizing. */
const TILE_PAD = 2.2;

interface MagnifierLoupeProps {
  active: boolean;
  doc: pdfjsLib.PDFDocumentProxy | null;
  /** Bumped when a new document loads, so a stale tile is dropped. */
  docVersion: number;
  pageNumber: number;
  /** User page rotation in degrees (0/90/180/270). */
  rotation: number;
  /** Display scale — the canvas occupies pageSize * scale CSS px. */
  scale: number;
  panX: number;
  panY: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface Tile {
  canvas: HTMLCanvasElement;
  /** Tile origin in loupe-viewport px. */
  originX: number;
  originY: number;
  w: number;
  h: number;
  loupeScale: number;
  pageNumber: number;
  rotation: number;
  docVersion: number;
}

/**
 * A magnifier that re-rasterizes the PDF under the cursor at high scale.
 *
 * Magnifying the already-rendered canvas would only enlarge its blur, so this
 * renders from the page itself. Rasterizing on every mouse move would be far
 * too slow on a dense sheet, so each render covers a tile larger than the
 * loupe window and subsequent moves blit from that tile until the cursor
 * approaches its edge.
 */
export function MagnifierLoupe({
  active, doc, docVersion, pageNumber, rotation, scale, panX, panY, containerRef,
}: MagnifierLoupeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tileRef = useRef<Tile | null>(null);
  const taskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const renderingRef = useRef(false);
  const frameRef = useRef<number | null>(null);

  // Cursor position in client coords, or null when it's outside the viewer.
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const cancelRender = useCallback(() => {
    if (taskRef.current) {
      taskRef.current.cancel();
      taskRef.current = null;
    }
  }, []);

  // Drop the cached tile whenever what it depicts changes.
  useEffect(() => {
    tileRef.current = null;
  }, [docVersion, pageNumber, rotation, scale]);

  // Track the cursor while active
  useEffect(() => {
    if (!active) { setCursor(null); return; }

    const onMove = (e: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const inside = e.clientX >= rect.left && e.clientX <= rect.right
        && e.clientY >= rect.top && e.clientY <= rect.bottom;
      setCursor(inside ? { x: e.clientX, y: e.clientY } : null);
    };

    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, [active, containerRef]);

  // Cleanup
  useEffect(() => () => {
    cancelRender();
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
  }, [cancelRender]);

  // Paint: reuse the cached tile when possible, otherwise rasterize a new one
  useEffect(() => {
    if (!active || !cursor || !doc) return;
    const container = containerRef.current;
    const visible = canvasRef.current;
    if (!container || !visible) return;

    let cancelled = false;

    async function paint() {
      const rect = container!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      const page = await doc!.getPage(pageNumber);
      if (cancelled) return;

      const totalRotation = (((page.rotate || 0) + rotation) % 360 + 360) % 360;
      const baseVp = page.getViewport({ scale: 1, rotation: totalRotation });

      // Cursor -> page units. The canvas is centered in the container, shifted
      // by pan, and occupies baseVp * scale CSS px.
      const centerX = rect.left + rect.width / 2 + panX;
      const centerY = rect.top + rect.height / 2 + panY;
      const pageX = (cursor!.x - centerX) / scale + baseVp.width / 2;
      const pageY = (cursor!.y - centerY) / scale + baseVp.height / 2;

      // Off the sheet — nothing to magnify
      if (pageX < 0 || pageY < 0 || pageX > baseVp.width || pageY > baseVp.height) {
        const ctx = visible!.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, visible!.width, visible!.height);
        return;
      }

      const loupeScale = Math.min(MAX_LOUPE_SCALE,
        Math.max(MIN_LOUPE_SCALE, scale * ZOOM_FACTOR));

      // Loupe window in loupe-viewport px
      const cx = pageX * loupeScale;
      const cy = pageY * loupeScale;
      const winX = cx - LOUPE_W / 2;
      const winY = cy - LOUPE_H / 2;

      const cached = tileRef.current;
      const usable = cached
        && cached.loupeScale === loupeScale
        && cached.pageNumber === pageNumber
        && cached.rotation === totalRotation
        && cached.docVersion === docVersion
        && winX >= cached.originX && winY >= cached.originY
        && winX + LOUPE_W <= cached.originX + cached.w
        && winY + LOUPE_H <= cached.originY + cached.h;

      if (!usable) {
        if (renderingRef.current) return; // a render is already in flight
        renderingRef.current = true;
        cancelRender();

        const tileW = LOUPE_W * TILE_PAD;
        const tileH = LOUPE_H * TILE_PAD;
        // Snap the origin onto the device-pixel grid. A fractional origin
        // rasterizes at a subpixel offset and then blits through
        // interpolation — both soften exactly the detail the loupe exists
        // to show.
        const originX = Math.round((cx - tileW / 2) * dpr) / dpr;
        const originY = Math.round((cy - tileH / 2) * dpr) / dpr;

        const tileCanvas = document.createElement('canvas');
        tileCanvas.width = Math.ceil(tileW * dpr);
        tileCanvas.height = Math.ceil(tileH * dpr);
        const tctx = tileCanvas.getContext('2d');
        if (!tctx) { renderingRef.current = false; return; }
        tctx.fillStyle = '#fff';
        tctx.fillRect(0, 0, tileCanvas.width, tileCanvas.height);

        const vp = page.getViewport({ scale: loupeScale, rotation: totalRotation });
        try {
          // Fold dpr and the tile offset into one transform: canvas px =
          // dpr * (viewport px - tile origin).
          const task = page.render({
            canvasContext: tctx,
            viewport: vp,
            transform: [dpr, 0, 0, dpr, -originX * dpr, -originY * dpr],
          });
          taskRef.current = task;
          await task.promise;
        } catch (err: any) {
          if (err?.name !== 'RenderingCancelledException') {
            console.error('Loupe render error:', err);
          }
          renderingRef.current = false;
          return;
        } finally {
          taskRef.current = null;
        }
        renderingRef.current = false;
        if (cancelled) return;

        tileRef.current = {
          canvas: tileCanvas, originX, originY, w: tileW, h: tileH,
          loupeScale, pageNumber, rotation: totalRotation, docVersion,
        };
      }

      const tile = tileRef.current;
      if (!tile) return;

      // Blit the loupe window out of the tile
      visible!.width = Math.ceil(LOUPE_W * dpr);
      visible!.height = Math.ceil(LOUPE_H * dpr);
      const ctx = visible!.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, visible!.width, visible!.height);
      // Integer source offset for the same reason — the loupe content then
      // steps in whole device pixels as the cursor moves, and stays crisp.
      const srcX = Math.round((winX - tile.originX) * dpr);
      const srcY = Math.round((winY - tile.originY) * dpr);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        tile.canvas,
        srcX, srcY,
        Math.round(LOUPE_W * dpr), Math.round(LOUPE_H * dpr),
        0, 0, Math.round(LOUPE_W * dpr), Math.round(LOUPE_H * dpr),
      );
    }

    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => { paint(); });

    return () => { cancelled = true; };
  }, [active, cursor, doc, docVersion, pageNumber, rotation, scale, panX, panY,
      containerRef, cancelRender]);

  if (!active || !cursor) return null;

  // Keep the loupe on screen: flip to the other side of the cursor near an edge
  const flipX = cursor.x + CURSOR_GAP + LOUPE_W > window.innerWidth;
  const flipY = cursor.y + CURSOR_GAP + LOUPE_H > window.innerHeight;
  const left = flipX ? cursor.x - CURSOR_GAP - LOUPE_W : cursor.x + CURSOR_GAP;
  const top = flipY ? cursor.y - CURSOR_GAP - LOUPE_H : cursor.y + CURSOR_GAP;

  return (
    <div
      style={{
        position: 'fixed', left, top, width: LOUPE_W, height: LOUPE_H,
        zIndex: 60, pointerEvents: 'none',
        borderRadius: 8, overflow: 'hidden',
        border: '1px solid var(--border)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
        background: '#fff',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: LOUPE_W, height: LOUPE_H, display: 'block' }}
      />
      {/* Crosshair marking the magnified point */}
      <svg width={LOUPE_W} height={LOUPE_H}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <line x1={LOUPE_W / 2 - 7} y1={LOUPE_H / 2} x2={LOUPE_W / 2 + 7} y2={LOUPE_H / 2}
          stroke="var(--accent)" strokeWidth={1} opacity={0.9} />
        <line x1={LOUPE_W / 2} y1={LOUPE_H / 2 - 7} x2={LOUPE_W / 2} y2={LOUPE_H / 2 + 7}
          stroke="var(--accent)" strokeWidth={1} opacity={0.9} />
      </svg>
    </div>
  );
}

export default MagnifierLoupe;
