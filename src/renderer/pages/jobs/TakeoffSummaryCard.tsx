import React, { useEffect, useState } from 'react';
import type { TakeoffRun, TakeoffItem, TakeoffArea, UtilityType } from '../../modules/underground/plan-takeoff/types';
import { UTILITY_COLORS, AREA_TYPE_LABELS } from '../../modules/underground/plan-takeoff/types';
import {
  computeRunLengthLF, computePolygonAreaSF, loadPageScaleMap,
} from '../../modules/underground/plan-takeoff/takeoffUtils';
import { squareFeetToYards } from '../../../shared/constants/units';

const UTILITY_LABELS: Record<UtilityType, string> = {
  sanitary: 'Sanitary',
  storm: 'Storm',
  water: 'Water',
  fiber: 'Fiber',
  other: 'Other',
};

interface TakeoffStats {
  lfByUtility: Partial<Record<UtilityType, number>>;
  itemCount: number;
  syByAreaType: Record<string, number>;
  uncalibratedPages: number[];
}

/**
 * Compact roll-up of measured takeoff quantities so the estimator can
 * sanity-check the bid against the plan. Hidden when no takeoff data exists.
 */
export function TakeoffSummaryCard({ jobId, onOpenTakeoff }: {
  jobId: number;
  onOpenTakeoff?: () => void;
}) {
  const [stats, setStats] = useState<TakeoffStats | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [runs, items, areas, scaleByPage] = await Promise.all([
          window.api.listTakeoffRuns(jobId) as Promise<TakeoffRun[]>,
          window.api.listTakeoffItems(jobId) as Promise<TakeoffItem[]>,
          window.api.listTakeoffAreas(jobId) as Promise<TakeoffArea[]>,
          loadPageScaleMap(jobId),
        ]);
        if (cancelled) return;

        const lfByUtility: Partial<Record<UtilityType, number>> = {};
        const syByAreaType: Record<string, number> = {};
        const uncalibrated = new Set<number>();

        for (const run of runs) {
          if (run.points.length < 2) continue;
          const scale = scaleByPage.get(run.pdfPage);
          if (!scale) { uncalibrated.add(run.pdfPage); continue; }
          lfByUtility[run.utilityType] = (lfByUtility[run.utilityType] || 0)
            + computeRunLengthLF(run.points, scale);
        }

        for (const area of areas) {
          if (area.points.length < 3) continue;
          const scale = scaleByPage.get(area.pdfPage);
          if (!scale) { uncalibrated.add(area.pdfPage); continue; }
          const label = AREA_TYPE_LABELS[area.areaType] ?? area.areaType;
          syByAreaType[label] = (syByAreaType[label] || 0)
            + squareFeetToYards(computePolygonAreaSF(area.points, scale));
        }

        const itemCount = items.reduce((s, i) => s + i.quantity, 0);

        const hasData = Object.keys(lfByUtility).length > 0 || itemCount > 0
          || Object.keys(syByAreaType).length > 0;
        setStats(hasData ? {
          lfByUtility, itemCount, syByAreaType,
          uncalibratedPages: Array.from(uncalibrated).sort((a, b) => a - b),
        } : null);
      } catch (err) {
        console.error('Failed to load takeoff summary:', err);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [jobId]);

  if (!stats) return null;

  const chipStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '4px 10px', borderRadius: 4, fontSize: 12,
    background: 'var(--bg-secondary)', border: '1px solid var(--border)',
    whiteSpace: 'nowrap',
  };

  return (
    <div className="card mb-24 no-print" style={{ padding: '10px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
          Takeoff
        </span>
        {(Object.keys(stats.lfByUtility) as UtilityType[]).map((ut) => (
          <span key={ut} style={chipStyle}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: UTILITY_COLORS[ut], flexShrink: 0 }} />
            {UTILITY_LABELS[ut]}: <b>{Math.round(stats.lfByUtility[ut]!).toLocaleString()} LF</b>
          </span>
        ))}
        {stats.itemCount > 0 && (
          <span style={chipStyle}>
            <span style={{ width: 8, height: 8, background: '#e91e63', transform: 'rotate(45deg)', flexShrink: 0 }} />
            Items: <b>{stats.itemCount}</b>
          </span>
        )}
        {Object.entries(stats.syByAreaType).map(([label, sy]) => (
          <span key={label} style={chipStyle}>
            {label}: <b>{sy.toFixed(1)} SY</b>
          </span>
        ))}
        {stats.uncalibratedPages.length > 0 && (
          <span style={{ ...chipStyle, color: '#d97706', borderColor: 'rgba(245,158,11,0.4)' }}
            title="Quantities on these pages are excluded until the page scale is calibrated">
            &#9888; Page{stats.uncalibratedPages.length > 1 ? 's' : ''} {stats.uncalibratedPages.join(', ')} not calibrated
          </span>
        )}
        <span style={{ flex: 1 }} />
        {onOpenTakeoff && (
          <button className="btn btn-sm btn-secondary" onClick={onOpenTakeoff} style={{ fontSize: 11 }}>
            Open Takeoff
          </button>
        )}
      </div>
    </div>
  );
}
