import React, { useCallback } from 'react';
import type { PdfPoint, OverlayMode } from './types';

interface DrawingOverlayProps {
  /** PDF page width at scale=1 (PDF points) */
  pageWidth: number;
  /** PDF page height at scale=1 (PDF points) */
  pageHeight: number;
  /** Current pan offset in screen pixels */
  panX: number;
  panY: number;
  /** CSS zoom bridge: scale / renderedScale */
  cssZoom: number;
  /** The scale at which the canvas was last rendered */
  renderedScale: number;
  /** The overall display scale (zoom level set by user) */
  scale: number;
  /** Current interaction mode */
  mode: OverlayMode;
  /** Called with PDF-native coords when user clicks during an active mode */
  onPointClick?: (point: PdfPoint) => void;
  /** SVG children (calibration markers, pipe runs, etc.) */
  children?: React.ReactNode;
}

/**
 * Convert a screen click to PDF-native coordinates (at scale=1).
 *
 * The PdfViewer canvas is flex-centered in its container. Its CSS transform is:
 *   translate(panX, panY) scale(cssZoom)
 * with transform-origin: center center.
 *
 * The canvas base size (before CSS zoom) is pageWidth*renderedScale x pageHeight*renderedScale.
 * After CSS zoom the visual size is pageWidth*scale x pageHeight*scale.
 */
function screenToPdf(
  clientX: number,
  clientY: number,
  containerRect: DOMRect,
  pageWidth: number,
  pageHeight: number,
  panX: number,
  panY: number,
  scale: number,
): PdfPoint {
  // Position relative to container center
  const cx = clientX - containerRect.left - containerRect.width / 2;
  const cy = clientY - containerRect.top - containerRect.height / 2;

  // Remove pan, then remove scale to get PDF-native offset from page center
  const pdfX = (cx - panX) / scale + pageWidth / 2;
  const pdfY = (cy - panY) / scale + pageHeight / 2;

  return { x: pdfX, y: pdfY };
}

export function DrawingOverlay({
  pageWidth, pageHeight, panX, panY, cssZoom, renderedScale, scale,
  mode, onPointClick, children,
}: DrawingOverlayProps) {
  const isActive = mode !== 'none';

  const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!isActive || !onPointClick) return;
    const svg = e.currentTarget;
    const container = svg.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const point = screenToPdf(e.clientX, e.clientY, rect, pageWidth, pageHeight, panX, panY, scale);
    onPointClick(point);
  }, [isActive, onPointClick, pageWidth, pageHeight, panX, panY, scale]);

  if (pageWidth === 0 || pageHeight === 0) return null;

  return (
    <svg
      onClick={handleClick}
      viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: pageWidth * renderedScale,
        height: pageHeight * renderedScale,
        transform: `translate(-50%, -50%) translate(${panX}px, ${panY}px) scale(${cssZoom})`,
        transformOrigin: 'center center',
        pointerEvents: isActive ? 'all' : 'none',
        cursor: isActive ? 'crosshair' : 'default',
        overflow: 'visible',
      }}
    >
      {children}
    </svg>
  );
}

export { screenToPdf };
