import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { PdfPoint, OverlayMode } from './types';
import {
  fromDisplay, unitLabel, METERS_PER_FOOT, DEFAULT_UNIT_SYSTEM, type UnitSystem,
} from '../../../../shared/unitSystem';

/** PDF standard: 72 points per inch */
const PDF_PTS_PER_INCH = 72;

/** PDF points per real foot on a 1:1 drawing (72 pt/in \u00d7 12 in/ft) \u2014 divide
 *  by a ratio scale's R (1:R) to get px/ft. */
const PDF_PTS_PER_FT = PDF_PTS_PER_INCH * 12;

/** Common civil plan scales, engineering format (1" = X') */
const COMMON_SCALES = [10, 20, 30, 40, 50, 60, 100];

/** Common metric civil plan scales, ratio format (1:R) */
const COMMON_RATIOS = [50, 100, 200, 250, 500, 1000];

export interface ScaleResult {
  pxPerFt: number;
  /** Only present for two-point calibration */
  point1?: PdfPoint;
  point2?: PdfPoint;
  distanceFt?: number;
}

interface UseScaleCalibrationOptions {
  active: boolean;
  pageWidth: number;
  pageHeight: number;
  system?: UnitSystem;
  onComplete: (result: ScaleResult) => void;
  onCancel: () => void;
}

type CalibrationStep =
  | 'choose-method'
  | 'pick-p1'
  | 'pick-p2'
  | 'input-distance'
  | 'confirm'
  | 'direct-entry';

/** Compute scale in engineering format (1" = X') or metric ratio (1:R). */
export function formatScale(pxPerFt: number, system: UnitSystem = DEFAULT_UNIT_SYSTEM): string {
  if (!pxPerFt || pxPerFt <= 0) return 'No scale';
  if (system === 'metric') {
    const ratio = PDF_PTS_PER_FT / pxPerFt;
    return `1:${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}`;
  }
  const ftPerInch = PDF_PTS_PER_INCH / pxPerFt;
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
  active, pageWidth, pageHeight, system = DEFAULT_UNIT_SYSTEM, onComplete, onCancel,
}: UseScaleCalibrationOptions) {
  const [step, setStep] = useState<CalibrationStep>('choose-method');
  const [point1, setPoint1] = useState<PdfPoint | null>(null);
  const [point2, setPoint2] = useState<PdfPoint | null>(null);
  const [distanceInput, setDistanceInput] = useState('');
  const [computedPxPerFt, setComputedPxPerFt] = useState<number | null>(null);
  const [directInput, setDirectInput] = useState('');
  const distInputRef = useRef<HTMLInputElement>(null);
  const directInputRef = useRef<HTMLInputElement>(null);

  // Reset state when calibration activates
  useEffect(() => {
    if (active) {
      setStep('choose-method');
      setPoint1(null);
      setPoint2(null);
      setDistanceInput('');
      setComputedPxPerFt(null);
      setDirectInput('');
    }
  }, [active]);

  // Focus inputs when reaching relevant steps
  useEffect(() => {
    if (step === 'input-distance') {
      setTimeout(() => distInputRef.current?.focus(), 50);
    } else if (step === 'direct-entry') {
      setTimeout(() => directInputRef.current?.focus(), 50);
    }
  }, [step]);

  // -- Two-point calibration handlers --

  const handlePointClick = useCallback((p: PdfPoint) => {
    if (step === 'pick-p1') {
      setPoint1(p);
      setStep('pick-p2');
    } else if (step === 'pick-p2') {
      if (point1 && pixelDistance(point1, p) < 1) return;
      setPoint2(p);
      setStep('input-distance');
    }
  }, [step, point1]);

  const handleDistanceSubmit = useCallback(() => {
    // The user types the known distance in their system's unit (ft / m);
    // the stored scale is canonical px-per-ft either way.
    const typed = parseFloat(distanceInput);
    if (!point1 || !point2 || !isFinite(typed) || typed <= 0) return;
    const ft = fromDisplay(typed, 'ft', system);
    const distPx = pixelDistance(point1, point2);
    if (distPx < 1) return;
    const pxPerFt = distPx / ft;
    setComputedPxPerFt(pxPerFt);
    setStep('confirm');
  }, [distanceInput, point1, point2, system]);

  const handleAcceptTwoPoint = useCallback(() => {
    if (!point1 || !point2 || !computedPxPerFt) return;
    onComplete({
      pxPerFt: computedPxPerFt,
      point1,
      point2,
      distanceFt: fromDisplay(parseFloat(distanceInput), 'ft', system),
    });
  }, [point1, point2, computedPxPerFt, distanceInput, system, onComplete]);

  const handleRedo = useCallback(() => {
    setStep('pick-p1');
    setPoint1(null);
    setPoint2(null);
    setDistanceInput('');
    setComputedPxPerFt(null);
  }, []);

  // -- Direct entry handlers --

  // Direct entry: imperial takes the X of an engineering scale (1" = X'),
  // metric the R of a ratio scale (1:R). Both resolve to canonical px/ft.
  const handlePresetClick = useCallback((value: number) => {
    onComplete({
      pxPerFt: system === 'metric' ? PDF_PTS_PER_FT / value : PDF_PTS_PER_INCH / value,
    });
  }, [system, onComplete]);

  const handleDirectSubmit = useCallback(() => {
    const value = parseFloat(directInput);
    if (!isFinite(value) || value <= 0) return;
    onComplete({
      pxPerFt: system === 'metric' ? PDF_PTS_PER_FT / value : PDF_PTS_PER_INCH / value,
    });
  }, [directInput, system, onComplete]);

  // -- Shared --

  const handleCancel = useCallback(() => onCancel(), [onCancel]);

  // Escape key cancels
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

  // -- SVG calibration markers --
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

  const panelStyle: React.CSSProperties = {
    position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
    background: 'var(--bg-primary, #fff)', border: '1px solid var(--border-color, #e0e0e0)',
    borderRadius: 8, padding: '10px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    zIndex: 10, fontSize: 13,
  };

  const inlineStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };

  let panelContent: React.ReactNode = null;

  if (active) {
    if (step === 'choose-method') {
      panelContent = (
        <div style={panelStyle}>
          <div style={inlineStyle}>
            <span style={{ fontWeight: 500 }}>Set Scale:</span>
            <button className="btn btn-primary btn-sm" onClick={() => setStep('pick-p1')}>
              Click Two Points
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setStep('direct-entry')}>
              Enter Scale
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handleCancel}>Cancel</button>
          </div>
        </div>
      );
    } else if (step === 'pick-p1') {
      panelContent = (
        <div style={panelStyle}>
          <div style={inlineStyle}>
            <span style={{ fontWeight: 500 }}>Set Scale:</span>
            <span>Click the first point on a known dimension</span>
            <button className="btn btn-secondary btn-sm" onClick={handleCancel}>Cancel</button>
          </div>
        </div>
      );
    } else if (step === 'pick-p2') {
      panelContent = (
        <div style={panelStyle}>
          <div style={inlineStyle}>
            <span style={{ fontWeight: 500 }}>Set Scale:</span>
            <span>Click the second point</span>
            <button className="btn btn-secondary btn-sm" onClick={handleCancel}>Cancel</button>
          </div>
        </div>
      );
    } else if (step === 'input-distance') {
      panelContent = (
        <div style={panelStyle}>
          <div style={inlineStyle}>
            <span style={{ fontWeight: 500 }}>Distance between points:</span>
            <input
              ref={distInputRef}
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
            <span style={{ color: 'var(--text-secondary)' }}>{unitLabel('ft', system)}</span>
            <button className="btn btn-primary btn-sm" onClick={handleDistanceSubmit}
              disabled={!distanceInput || !isFinite(parseFloat(distanceInput)) || parseFloat(distanceInput) <= 0}>
              OK
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handleCancel}>Cancel</button>
          </div>
        </div>
      );
    } else if (step === 'confirm' && computedPxPerFt) {
      panelContent = (
        <div style={panelStyle}>
          <div style={inlineStyle}>
            <span style={{ fontWeight: 500 }}>Scale: {formatScale(computedPxPerFt, system)}</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
              {system === 'metric'
                ? `(${(computedPxPerFt / METERS_PER_FOOT).toFixed(1)} px/m)`
                : `(${computedPxPerFt.toFixed(1)} px/ft)`}
            </span>
            <button className="btn btn-primary btn-sm" onClick={handleAcceptTwoPoint}>Accept</button>
            <button className="btn btn-secondary btn-sm" onClick={handleRedo}>Redo</button>
            <button className="btn btn-secondary btn-sm" onClick={handleCancel}>Cancel</button>
          </div>
        </div>
      );
    } else if (step === 'direct-entry') {
      panelContent = (
        <div style={panelStyle}>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>Enter Drawing Scale</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {system === 'metric'
              ? COMMON_RATIOS.map((r) => (
                <button key={r} className="btn btn-secondary btn-sm"
                  style={{ fontSize: 12 }}
                  onClick={() => handlePresetClick(r)}>
                  1:{r}
                </button>
              ))
              : COMMON_SCALES.map((ft) => (
                <button key={ft} className="btn btn-secondary btn-sm"
                  style={{ fontSize: 12 }}
                  onClick={() => handlePresetClick(ft)}>
                  1&quot; = {ft}&apos;
                </button>
              ))}
          </div>
          <div style={inlineStyle}>
            <span style={{ color: 'var(--text-secondary)' }}>
              {system === 'metric' ? 'Custom: 1 :' : <>Custom: 1&quot; =</>}
            </span>
            <input
              ref={directInputRef}
              type="number"
              className="form-control"
              style={{ width: 72, padding: '4px 8px' }}
              value={directInput}
              onChange={(e) => setDirectInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleDirectSubmit(); }}
              placeholder="0"
              min="0.01"
              step="any"
            />
            {system !== 'metric' && <span style={{ color: 'var(--text-secondary)' }}>ft</span>}
            <button className="btn btn-primary btn-sm" onClick={handleDirectSubmit}
              disabled={!directInput || !isFinite(parseFloat(directInput)) || parseFloat(directInput) <= 0}>
              Apply
            </button>
            <button className="btn btn-secondary btn-sm" onClick={handleCancel}>Cancel</button>
          </div>
        </div>
      );
    }
  }

  return {
    overlayMode,
    handlePointClick,
    svgContent,
    panelContent,
  };
}
