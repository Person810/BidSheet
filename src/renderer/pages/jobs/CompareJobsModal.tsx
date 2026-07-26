import React, { useEffect, useMemo, useState } from 'react';
import { formatCurrency } from './helpers';
import { dismissOnEscOnly } from '../../components/modalDismiss';

interface SectionTotals {
  name: string;
  isAlternate: boolean;
  total: number;
}

interface JobSide {
  job: any;
  summary: any;
  sections: SectionTotals[];
}

async function loadSide(jobId: number): Promise<JobSide> {
  const [job, summary, sections] = await Promise.all([
    window.api.getJob(jobId),
    window.api.getBidSummary(jobId),
    window.api.getBidSections(jobId),
  ]);
  const sectionTotals: SectionTotals[] = await Promise.all(
    sections.map(async (sec: any) => {
      const items = await window.api.getBidLineItems(sec.id);
      return {
        name: sec.name,
        isAlternate: sec.is_alternate === 1,
        total: items.reduce((s: number, i: any) => s + (i.total_cost || 0), 0),
      };
    }),
  );
  return { job, summary, sections: sectionTotals };
}

function Delta({ value }: { value: number }) {
  if (Math.abs(value) < 0.005) return <span className="text-muted">--</span>;
  const positive = value > 0;
  return (
    <span style={{ color: positive ? 'var(--danger, #ef4444)' : 'var(--success)', fontWeight: 600 }}>
      {positive ? '+' : ''}{formatCurrency(value)}
    </span>
  );
}

/**
 * Side-by-side what-if comparison of two estimates (e.g. a job and its
 * duplicated scenario): per-section direct costs matched by name, then the
 * markup stack and grand totals, with deltas.
 */
export function CompareJobsModal({ baseJobId, onClose }: {
  baseJobId: number;
  onClose: () => void;
}) {
  const [jobs, setJobs] = useState<any[]>([]);
  const [otherJobId, setOtherJobId] = useState<number | null>(null);
  const [left, setLeft] = useState<JobSide | null>(null);
  const [right, setRight] = useState<JobSide | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    window.api.getJobs().then((all: any[]) => {
      setJobs(all.filter((j) => j.id !== baseJobId));
    });
    loadSide(baseJobId).then(setLeft);
  }, [baseJobId]);

  useEffect(() => {
    if (otherJobId == null) { setRight(null); return; }
    setLoading(true);
    // Staleness guard: picking another job while a slow load is in flight
    // must not let the older result land over the newer selection.
    let stale = false;
    loadSide(otherJobId)
      .then((side) => { if (!stale) setRight(side); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [otherJobId]);

  // Match sections by name (base bid only); unmatched sections show on one side
  const sectionRows = useMemo(() => {
    if (!left || !right) return [];
    const names = new Map<string, { left?: SectionTotals; right?: SectionTotals }>();
    for (const s of left.sections.filter((x) => !x.isAlternate)) {
      names.set(s.name, { ...(names.get(s.name) || {}), left: s });
    }
    for (const s of right.sections.filter((x) => !x.isAlternate)) {
      names.set(s.name, { ...(names.get(s.name) || {}), right: s });
    }
    return Array.from(names.entries()).map(([name, pair]) => ({
      name,
      left: pair.left?.total ?? null,
      right: pair.right?.total ?? null,
    }));
  }, [left, right]);

  const summaryRow = (label: string, key: string) => {
    if (!left?.summary || !right?.summary) return null;
    const l = left.summary[key] || 0;
    const r = right.summary[key] || 0;
    if (l === 0 && r === 0 && key !== 'grandTotal' && key !== 'direct_cost_total') return null;
    const isTotal = key === 'grandTotal';
    return (
      <tr key={key} style={isTotal ? { fontWeight: 700 } : undefined}>
        <td style={isTotal ? { color: 'var(--accent)' } : undefined}>{label}</td>
        <td className="text-right">{formatCurrency(l)}</td>
        <td className="text-right">{formatCurrency(r)}</td>
        <td className="text-right"><Delta value={r - l} /></td>
      </tr>
    );
  };

  return (
    <div className="modal-overlay" onClick={dismissOnEscOnly(onClose)}>
      <div className="modal" style={{ maxWidth: 780 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 12 }}>Compare Estimates</h3>

        <div className="form-group" style={{ maxWidth: 420 }}>
          <label className="form-label">Compare {left?.job?.name || 'this job'} against</label>
          <select className="form-control" value={otherJobId ?? ''}
            onChange={(e) => setOtherJobId(Number(e.target.value) || null)} autoFocus>
            <option value="">-- Select a job (e.g. a duplicated scenario) --</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}{j.job_number ? ` (#${j.job_number})` : ''}{j.parent_job_id ? ` (CO #${j.change_order_number})` : ''}
              </option>
            ))}
          </select>
        </div>

        {loading && <p className="text-muted" style={{ fontSize: 13 }}>Loading...</p>}

        {left && right && !loading && (
          <>
            <table className="data-table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Section (direct cost)</th>
                  <th className="text-right" style={{ width: 140 }}>{left.job.name}</th>
                  <th className="text-right" style={{ width: 140 }}>{right.job.name}</th>
                  <th className="text-right" style={{ width: 130 }}>&Delta;</th>
                </tr>
              </thead>
              <tbody>
                {sectionRows.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td className="text-right">{row.left != null ? formatCurrency(row.left) : <span className="text-muted">--</span>}</td>
                    <td className="text-right">{row.right != null ? formatCurrency(row.right) : <span className="text-muted">--</span>}</td>
                    <td className="text-right"><Delta value={(row.right ?? 0) - (row.left ?? 0)} /></td>
                  </tr>
                ))}
              </tbody>
              <tbody style={{ borderTop: '2px solid var(--border)' }}>
                {summaryRow('Direct Cost', 'direct_cost_total')}
                {summaryRow('Material Escalation', 'escalation')}
                {summaryRow('Indirect Costs', 'indirect_total')}
                {summaryRow('Overhead', 'overhead')}
                {summaryRow('Profit', 'profit')}
                {summaryRow('Bond', 'bond')}
                {summaryRow('Sales Tax', 'tax')}
                {summaryRow('BID TOTAL', 'grandTotal')}
              </tbody>
            </table>
            <p className="text-muted" style={{ fontSize: 11, marginTop: 8 }}>
              Sections matched by name; base bid only (alternates excluded). &Delta; is the second job relative to the first.
            </p>
          </>
        )}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
