import React from 'react';
import { calculateTrench, type TrenchInput } from '../trenchCalc';
import type { TakeoffRun, PdfPoint } from './types';

interface RunSummaryPanelProps {
  runs: TakeoffRun[];
  allRuns: TakeoffRun[];
  activeRunId: number | null;
  selectedRunId: number | null;
  scalePxPerFt: number;
  pageNumber: number;
  onSelectRun: (runId: number | null) => void;
  onEditRun: (runId: number) => void;
  onDeleteRun: (runId: number) => void;
  onSendToProfiles?: () => void;
}

function computeRunLengthLF(points: PdfPoint[], scalePxPerFt: number): number {
  let totalPx = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    totalPx += Math.sqrt(dx * dx + dy * dy);
  }
  return totalPx / scalePxPerFt;
}

function buildTrenchInput(run: TakeoffRun, runLengthLF: number): TrenchInput {
  return {
    pipeSizeIn: run.pipeSizeIn,
    pipeMaterial: run.pipeMaterial,
    startDepthFt: run.startDepthFt,
    gradePct: run.gradePct,
    runLengthLF,
    trenchWidthFt: run.trenchWidthFt,
    benchWidthFt: run.benchWidthFt,
    beddingDepthFt: run.beddingDepthFt,
    backfillType: run.backfillType,
  };
}

export function RunSummaryPanel({
  runs, allRuns, activeRunId, selectedRunId, scalePxPerFt, pageNumber,
  onSelectRun, onEditRun, onDeleteRun, onSendToProfiles,
}: RunSummaryPanelProps) {
  const focusedRun = runs.find((r) => r.id === (activeRunId ?? selectedRunId));

  return (
    <div style={{
      width: 280, flexShrink: 0, borderLeft: '1px solid var(--border)',
      background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {focusedRun ? (
        <RunDetail
          run={focusedRun}
          scalePxPerFt={scalePxPerFt}
          isActive={focusedRun.id === activeRunId}
          onEdit={() => onEditRun(focusedRun.id)}
          onDelete={() => onDeleteRun(focusedRun.id)}
        />
      ) : (
        <RunList
          runs={runs}
          allRuns={allRuns}
          scalePxPerFt={scalePxPerFt}
          onSelect={onSelectRun}
          onSendToProfiles={onSendToProfiles}
          activeRunId={activeRunId}
        />
      )}
    </div>
  );
}

/* ---- Detail view for active / selected run ---- */

function RunDetail({ run, scalePxPerFt, isActive, onEdit, onDelete }: {
  run: TakeoffRun;
  scalePxPerFt: number;
  isActive: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const runLengthLF = computeRunLengthLF(run.points, scalePxPerFt);
  const result = runLengthLF > 0 ? calculateTrench(buildTrenchInput(run, runLengthLF)) : null;

  return (
    <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{
          width: 10, height: 10, borderRadius: '50%', background: run.color, flexShrink: 0,
        }} />
        <span style={{ fontWeight: 600, fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {run.label || 'Untitled Run'}
        </span>
        {isActive && (
          <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>DRAWING</span>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
        {run.utilityType.charAt(0).toUpperCase() + run.utilityType.slice(1)} &middot;{' '}
        {run.points.length} point{run.points.length !== 1 ? 's' : ''} &middot;{' '}
        {run.points.length > 1 ? run.points.length - 1 : 0} segment{run.points.length - 1 !== 1 ? 's' : ''}
      </div>

      {/* Quantities */}
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <tbody>
          <QtyRow label="Total LF" value={fmt(runLengthLF)} />
          {result && (
            <>
              <QtyRow label="Pipe LF" value={fmt(result.pipeLF)} />
              <QtyRow label="Excavation" value={`${fmt(result.excavationCY)} CY`} />
              <QtyRow label="Bedding" value={`${fmt(result.beddingCY)} CY`} />
              <QtyRow label="Backfill" value={`${fmt(result.backfillCY)} CY`} />
              <QtyRow label="Tracer Wire" value={`${fmt(result.tracerWireLF)} LF`} />
              <QtyRow label="Warning Tape" value={`${fmt(result.warningTapeLF)} LF`} />
            </>
          )}
        </tbody>
      </table>

      {/* Actions (only for completed / selected runs) */}
      {!isActive && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={onEdit}>
            Edit Config
          </button>
          <button className="btn btn-danger btn-sm" style={{ flex: 1 }} onClick={onDelete}>
            Delete Run
          </button>
        </div>
      )}
    </div>
  );
}

/* ---- Run list (no selection) ---- */

function RunList({ runs, allRuns, scalePxPerFt, onSelect, onSendToProfiles, activeRunId }: {
  runs: TakeoffRun[];
  allRuns: TakeoffRun[];
  scalePxPerFt: number;
  onSelect: (id: number) => void;
  onSendToProfiles?: () => void;
  activeRunId: number | null;
}) {
  const hasCompletedRuns = allRuns.some((r) => r.points.length >= 2);
  return (
    <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Runs ({runs.length})
      </div>
      {runs.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 24 }}>
          No runs on this page.
        </p>
      )}
      {runs.map((run, i) => {
        const globalIdx = allRuns.indexOf(run);
        const lf = computeRunLengthLF(run.points, scalePxPerFt);
        return (
          <div
            key={run.id}
            onClick={() => onSelect(run.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
              borderRadius: 4, cursor: 'pointer', marginBottom: 2,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: run.color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {run.label || `Run ${globalIdx + 1}`}
            </span>
            <span className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
              {fmt(lf)}'
            </span>
          </div>
        );
      })}
      {onSendToProfiles && hasCompletedRuns && !activeRunId && (
        <button
          className="btn btn-primary btn-sm"
          style={{ width: '100%', marginTop: 12 }}
          onClick={onSendToProfiles}
        >
          Send to Trench Profiles
        </button>
      )}
    </div>
  );
}

function QtyRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={{ padding: '3px 0', color: 'var(--text-secondary)' }}>{label}</td>
      <td style={{ padding: '3px 0', textAlign: 'right', fontWeight: 600 }}>{value}</td>
    </tr>
  );
}

function fmt(n: number): string {
  return n.toFixed(1);
}
