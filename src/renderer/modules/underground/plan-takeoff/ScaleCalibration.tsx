import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { PdfPoint, OverlayMode, TakeoffJobSettings } from './types';

export interface CalibrationResult {
  point1: PdfPoint;
  point2: PdfPoint;
  distanceFt: number;
  pxPerFt: number;
}

interface UseScaleCalibrationOptions {
  active: boolean;
  pageWidth: number;
  pageHeight: number;
  existingSettings: TakeoffJobSettings | null;
  onComplete: (result: CalibrationResult) => void;
  onCancel: () => void;
}

type CalibrationStep = 'pick-p1' | 'pick-p2' | 'input-distance' | 'confirm';

/** Compute scale in engineering format: "1\" = X'" */
export function formatScale(pxPerFt: number): string {
  const ftPerInch = 72 / pxPerFt;
  const rounded = Math.round(ftPerInch);
  if (rounded > 0 && Math.abs(ftPerInch - rounded) < 0.5) {
    return `1\u2033 = ${rounded}\u2032`;
  }
  return `1\u2033 = ${ftPerInch.toFixed(1)}\u2032`;
}

function pixelDistance(p1: PdfPoint, p2: PdfPoint): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function useScaleCalibration({
  active, pageWidth, pageHeight, existingSettings, onComplete, onCancel,
}: UseScaleCalibrationOptions) {
  const [step, setStep] = useState<CalibrationStep>('pick-p1');
  const [point1, setPoint1] = useState<PdfPoint | null>(null);
  const [point2, setPoint2] = useState<PdfPoint | null>(null);
  const [distanceInput, setDistanceInput] = useState('');
  const [computedPxPerFt, setComputedPxPerFt] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when calibration activates
  useEffect(() => {
    if (active) {
      setStep('pick-p1');
      setPoint1(null);
      setPoint2(null);
      setDistanceInput('');
      setComputedPxPerFt(null);
    }
  }, [active]);

  // Focus the distance input when we reach that step
  useEffect(() => {
    if (step === 'input-distance') {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [step]);

  const handlePointClick = useCallback((p: PdfPoint) => {
    if (step === 'pick-p1') {
      setPoint1(p);
      setStep('pick-p2');
    } else if (step === 'pick-p2') {
      setPoint2(p);
      setStep('input-distance');
    }
  }, [step]);

  const handleDistanceSubmit = useCallback(() => {
    const ft = parseFloat(distanceInput);
    if (!point1 || !point2 || !ft || ft <= 0) return;
    const distPx = pixelDistance(point1, point2);
    const pxPerFt = distPx / ft;
    setComputedPxPerFt(pxPerFt);
    setStep('confirm');
  }, [distanceInput, point1, point2]);

  const handleAccept = useCallback(() => {
    if (!point1 || !point2 || !computedPxPerFt) return;
    onComplete({
      point1,
      point2,
      distanceFt: parseFloat(distanceInput),
      pxPerFt: computedPxPerFt,
    });
  }, [point1, point2, computedPxPerFt, distanceInput, onComplete]);

  const handleRedo = useCallback(() => {
    setStep('pick-p1');
    setPoint1(null);
    setPoint2(null);
    setDistanceInput('');
    setComputedPxPerFt(null);
  }, []);

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  // Escape key cancels calibration
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, handleCancel]);

  // -- Overlay mode --
  let overlayMode: OverlayMode = 'none';
  if (active) {
    if (step === 'pick-p1') overlayMode = 'calibrate-p1';
    else if (step === 'pick-p2') overlayMode = 'calibrate-p2';
  }

  // -- SVG content (calibration markers + line) --
  // Circle radius in PDF-native units -- we want ~6px on screen, so divide by scale.
  // Using vectorEffect="non-scaling-stroke" keeps strokes constant, but circle r
  // is a geometric attribute so we handle constant-size circles differently:
  // we use a fixed radius and rely on the viewBox to handle it. Since the SVG
  // viewBox matches the PDF page, a radius of ~4 PDF units looks good at common
  // plan scales (e.g., a 3000x2000 pt page).
  const markerRadius = Math.max(3, Math.min(6, pageWidth / 200));

  const svgContent = active ? (
    <>
      {point1 && (
        <circle cx={point1.x} cy={point1.y} r={markerRadius}
          fill="rgba(239,68,68,0.3)" stroke="#ef4444" strokeWidth={2}
          vectorEffect="non-scaling-stroke" />
      )}
      {point2 && (
        <circle cx={point2.x} cy={point2.y} r={markerRadius}
          fill="rgba(239,68,68,0.3)" stroke="#ef4444" strokeWidth={2}
          vectorEffect="non-scaling-stroke" />
      )}
      {point1 && point2 && (
        <line x1={point1.x} y1={point1.y} x2={point2.x} y2={point2.y}
          stroke="#ef4444" strokeWidth={2} strokeDasharray="8 4"
          vectorEffect="non-scaling-stroke" />
      )}
    </>
  ) : null;

  // -- Floating panel content --
  const panelContent = active ? (
    <div style={{
      position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--bg-primary, #fff)', border: '1px solid var(--border-color, #e0e0e0)',
      borderRadius: 8, padding: '10px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      zIndex: 10, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
    }}>
      {step === 'pick-p1' && (
        <>
          <span style={{ fontWeight: 500 }}>Set Scale:</span>
          <span>Click the first point on a known dimension</span>
          <button className="btn btn-secondary btn-sm" onClick={handleCancel}>Cancel</button>
        </>
      )}
      {step === 'pick-p2' && (
        <>
          <span style={{ fontWeight: 500 }}>Set Scale:</span>
          <span>Click the second point</span>
          <button className="btn btn-secondary btn-sm" onClick={handleCancel}>Cancel</button>
        </>
      )}
      {step === 'input-distance' && (
        <>
          <span style={{ fontWeight: 500 }}>Distance between points:</span>
          <input
            ref={inputRef}
            type="number"
            className="form-control"
            style={{ width: 80, padding: '4px 8px' }}
            value={distanceInput}
            onChange={(e) => setDistanceInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleDistanceSubmit(); }}
            placeholder="0"
            min="0.01"
            step="any"
          />
          <span style={{ color: 'var(--text-secondary)' }}>ft</span>
          <button className="btn btn-primary btn-sm" onClick={handleDistanceSubmit}
            disabled={!distanceInput || parseFloat(distanceInput) <= 0}>
            OK
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleCancel}>Cancel</button>
        </>
      )}
      {step === 'confirm' && computedPxPerFt && (
        <>
          <span style={{ fontWeight: 500 }}>Scale: {formatScale(computedPxPerFt)}</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
            ({computedPxPerFt.toFixed(1)} px/ft)
          </span>
          <button className="btn btn-primary btn-sm" onClick={handleAccept}>Accept</button>
          <button className="btn btn-secondary btn-sm" onClick={handleRedo}>Redo</button>
          <button className="btn btn-secondary btn-sm" onClick={handleCancel}>Cancel</button>
        </>
      )}
    </div>
  ) : null;

  return {
    overlayMode,
    handlePointClick,
    svgContent,
    panelContent,
  };
}
