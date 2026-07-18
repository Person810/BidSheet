import React from 'react';
import type { DepthZone } from './trenchCalc';

/**
 * Depth-band breakdown of a trench run -- LF and excavation CY per band, the
 * same shape as Carlson's "Depth Summary" / AGTEK's depth-bracket analysis.
 * Deeper bands typically trigger shoring/trench-box costs, so estimators
 * price off this split rather than a single average-depth number.
 */
export function DepthZoneTable({ zones }: { zones: DepthZone[] }) {
  if (zones.length === 0) return null;

  return (
    <table className="data-table" style={{ fontSize: 13 }}>
      <thead>
        <tr>
          <th>Depth</th>
          <th className="text-right">LF</th>
          <th className="text-right">Excavation (CY)</th>
        </tr>
      </thead>
      <tbody>
        {zones.map((z) => (
          <tr key={z.label}>
            <td>{z.label}</td>
            <td className="text-right">{z.lf}</td>
            <td className="text-right">{z.excavationCY}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
