import React, { useState } from 'react';
import { toDisplay, fromDisplay, roundTo, type QuantityKind } from '../../shared/unitSystem';
import { useUnitSystem } from '../stores/units-store';

interface UnitInputProps {
  /** Canonical (imperial) value — what the parent stores and calculates with. */
  value: number;
  /** The canonical unit `value` is in; decides the metric conversion + label. */
  kind: QuantityKind;
  /** Receives the canonical value of whatever the user typed, full precision. */
  onChange: (canonical: number) => void;
  /** Spinner step in imperial mode (matches the old hardcoded steps). */
  step: number;
  /** Spinner step in metric mode, in the metric unit. */
  metricStep: number;
  min?: number;
  className?: string;
  placeholder?: string;
  /**
   * Metric mode only: offer a m ⇄ mm picker beside the field, for dimensions
   * where whole metres are coarse (bedding depth, wall height). Only for
   * kinds that display in metres ('ft'/'lf'); the canonical value, the
   * spinner's metre step (×1000 in mm), and imperial mode are unaffected.
   * When set, the parent's label should omit the unit — the picker shows it.
   */
  mmToggle?: boolean;
}

/**
 * Number input that speaks the active unit system while its value stays
 * canonical imperial (#97): a metric user sees and types metres/mm, the
 * parent keeps feet/inches at full precision, and display rounding
 * (toDisplay) guarantees a typed 0.9 m renders back as exactly 0.9.
 */
export function UnitInput({
  value, kind, onChange, step, metricStep, min, className, placeholder, mmToggle,
}: UnitInputProps) {
  const system = useUnitSystem();
  const [useMm, setUseMm] = useState(false);

  if (system === 'metric' && mmToggle) {
    const metres = toDisplay(value, kind, system);
    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="number"
          className={className}
          style={{ flex: 1, minWidth: 0 }}
          value={useMm ? roundTo(metres * 1000, 2) : metres}
          step={useMm ? metricStep * 1000 : metricStep}
          min={min}
          placeholder={placeholder}
          onChange={(e) => {
            const typed = parseFloat(e.target.value) || 0;
            onChange(fromDisplay(useMm ? typed / 1000 : typed, kind, system));
          }}
        />
        <select
          className={className}
          value={useMm ? 'mm' : 'm'}
          onChange={(e) => setUseMm(e.target.value === 'mm')}
          aria-label="Unit"
          style={{ width: 64, flexShrink: 0 }}
        >
          <option value="m">m</option>
          <option value="mm">mm</option>
        </select>
      </div>
    );
  }

  return (
    <input
      type="number"
      className={className}
      value={toDisplay(value, kind, system)}
      step={system === 'metric' ? metricStep : step}
      min={min}
      placeholder={placeholder}
      onChange={(e) => onChange(fromDisplay(parseFloat(e.target.value) || 0, kind, system))}
    />
  );
}
