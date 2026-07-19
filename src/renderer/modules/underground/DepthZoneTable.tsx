import React from 'react';
import type { DepthZone } from './trenchCalc';
import { useUnitSystem } from '../../stores/units-store';
import { unitLabel, convertQty, roundTo, formatDepthBand } from '../../../shared/unitSystem';

/**
 * Depth-band breakdown of a trench run -- LF and excavation CY per band, the
 * same shape as Carlson's "Depth Summary" / AGTEK's depth-bracket analysis.
 * Deeper bands typically trigger shoring/trench-box costs, so estimators
 * price off this split rather than a single average-depth number.
 * Zones arrive in canonical feet/CY; metric mode converts at render (#97).
 */
export function DepthZoneTable({ zones }: { zones: DepthZone[] }) {
  const system = useUnitSystem();
  if (zones.length === 0) return null;

  return (
    <table className="data-table" style={{ fontSize: 13 }}>
      <thead>
        <tr>
          <th>Depth</th>
          <th className="text-right">{unitLabel('lf', system)}</th>
          <th className="text-right">Excavation ({unitLabel('cy', system)})</th>
        </tr>
      </thead>
      <tbody>
        {zones.map((z) => (
          <tr key={z.label}>
            <td>{formatDepthBand(z.loFt, z.hiFt, system)}</td>
            <td className="text-right">{roundTo(convertQty(z.lf, 'lf', system), 2)}</td>
            <td className="text-right">{roundTo(convertQty(z.excavationCY, 'cy', system), 2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
