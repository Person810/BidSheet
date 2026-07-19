import React, { useMemo } from 'react';
import { formatCurrency } from './helpers';
import { useToastStore } from '../../stores/toast-store';
import { neutralizeCsvFormula } from '../../../shared/csvSafe';
import { computeBidAnalysis, CREW_DAY_HOURS } from './bidAnalysis';
import { convertQty, formatPipeSize, metricUnitPrice, unitLabel } from '../../../shared/unitSystem';
import { useUnitSystem } from '../../stores/units-store';

function csvEscape(value: string | number): string {
  const s = neutralizeCsvFormula(String(value));
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

/**
 * The pre-submit sanity check: total effort, margin by section, and $/LF
 * by pipe size. These are the numbers an estimator compares against gut
 * feel ("is $85/LF for 8-inch at 6 feet plausible?") before the bid goes
 * out the door.
 */
export function BidAnalysisModal({ job, sections, lineItems, onClose }: {
  job: any;
  sections: any[];
  lineItems: Record<number, any[]>;
  onClose: () => void;
}) {
  const addToast = useToastStore((s) => s.addToast);
  const system = useUnitSystem();
  const metric = system === 'metric';
  // Pipe aggregates are canonical LF / $-per-LF; convert at display only.
  const pipeLen = (lf: number) => (metric ? convertQty(lf, 'lf', system) : lf);
  const perLen = (perLF: number) => (metric ? metricUnitPrice(perLF, 'lf') : perLF);

  const analysis = useMemo(
    () => computeBidAnalysis(sections, lineItems, {
      overhead_percent: job.overhead_percent || 0,
      profit_percent: job.profit_percent || 0,
      bond_percent: job.bond_percent,
      tax_percent: job.tax_percent,
      escalation_percent: job.escalation_percent,
    }),
    [sections, lineItems, job],
  );

  const hasItems = analysis.sections.some((s) =>
    s.directCost > 0 || s.laborHours > 0 || s.equipmentHours > 0);

  const handleExport = async () => {
    const lines: string[] = [];
    lines.push('﻿' + ['Section', 'Alternate', 'Material', 'Labor', 'Equipment', 'Sub',
      'Direct Cost', 'Sell', 'Margin', 'Margin %', 'Labor Hours', 'Equipment Hours',
      metric ? 'Pipe m' : 'Pipe LF'].map(csvEscape).join(','));
    for (const s of analysis.sections) {
      lines.push([
        s.name, s.isAlternate ? 'yes' : '', s.material.toFixed(2), s.labor.toFixed(2),
        s.equipment.toFixed(2), s.sub.toFixed(2), s.directCost.toFixed(2),
        s.sellTotal.toFixed(2), s.margin.toFixed(2),
        s.sellTotal > 0 ? ((s.margin / s.sellTotal) * 100).toFixed(1) : '0',
        s.laborHours.toFixed(1), s.equipmentHours.toFixed(1), pipeLen(s.pipeLF).toFixed(1),
      ].map(csvEscape).join(','));
    }
    lines.push('');
    lines.push((metric
      ? ['Pipe Size', 'Total m', 'Direct Cost', 'Direct $/m']
      : ['Pipe Size (in)', 'Total LF', 'Direct Cost', 'Direct $/LF']).map(csvEscape).join(','));
    for (const p of analysis.pipeSizes) {
      lines.push([
        metric ? formatPipeSize(p.sizeIn, system) : p.sizeIn,
        pipeLen(p.totalLF).toFixed(1), p.directCost.toFixed(2), perLen(p.directPerLF).toFixed(2),
      ].map(csvEscape).join(','));
    }
    lines.push('');
    lines.push(['Total Labor Hours', analysis.laborHours.toFixed(1)].map(csvEscape).join(','));
    lines.push([`Crew-Days (${CREW_DAY_HOURS} hr)`, analysis.crewDays.toFixed(1)].map(csvEscape).join(','));
    lines.push(['Total Equipment Hours', analysis.equipmentHours.toFixed(1)].map(csvEscape).join(','));

    const safeName = (job.job_number || job.name || 'job').replace(/[^a-zA-Z0-9_-]/g, '_');
    try {
      const result = await window.api.saveCsv(
        `${safeName}-bid-analysis.csv`, 'Export Bid Analysis', lines.join('\r\n') + '\r\n',
      );
      if (result?.success) addToast(`Bid analysis saved to ${result.path}`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Export failed', 'error');
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 900 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Bid Analysis</h3>
          <button className="btn btn-sm btn-secondary" onClick={handleExport} disabled={!hasItems}>
            Export CSV
          </button>
        </div>

        {!hasItems ? (
          <p className="text-muted" style={{ fontSize: 13 }}>
            No line items yet. Add line items to see effort, margin, and {metric ? '$/m' : '$/LF'} here.
          </p>
        ) : (
          <>
            {/* Effort strip */}
            <div className="flex gap-8" style={{ marginBottom: 16 }}>
              {[
                { label: 'Labor hours', value: fmt1(analysis.laborHours) },
                { label: `Crew-days (${CREW_DAY_HOURS} hr)`, value: fmt1(analysis.crewDays) },
                { label: 'Equipment hours', value: fmt1(analysis.equipmentHours) },
              ].map((c) => (
                <div key={c.label} className="card" style={{ flex: 1, padding: '10px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{c.value}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{c.label}</div>
                </div>
              ))}
            </div>

            {/* Margin by section */}
            <table className="data-table" style={{ marginBottom: 16 }}>
              <thead>
                <tr>
                  <th>Section</th>
                  <th className="text-right">Direct Cost</th>
                  <th className="text-right">Sell</th>
                  <th className="text-right">Margin</th>
                  <th className="text-right">Margin %</th>
                  <th className="text-right">Labor Hrs</th>
                  <th className="text-right">Equip Hrs</th>
                </tr>
              </thead>
              <tbody>
                {analysis.sections.map((s) => (
                  <tr key={s.sectionId}>
                    <td style={{ fontWeight: 600 }}>
                      {s.name}
                      {s.isAlternate && <span className="text-muted" style={{ fontSize: 11 }}> (alternate)</span>}
                    </td>
                    <td className="text-right">{formatCurrency(s.directCost)}</td>
                    <td className="text-right">{formatCurrency(s.sellTotal)}</td>
                    <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(s.margin)}</td>
                    <td className="text-right text-muted">
                      {s.sellTotal > 0 ? ((s.margin / s.sellTotal) * 100).toFixed(1) : '0'}%
                    </td>
                    <td className="text-right">{fmt1(s.laborHours)}</td>
                    <td className="text-right">{fmt1(s.equipmentHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* $/LF by pipe size */}
            {analysis.pipeSizes.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Pipe Size</th>
                    <th className="text-right">Total {unitLabel('lf', system)}</th>
                    <th className="text-right">Direct Cost</th>
                    <th className="text-right">Direct $/{metric ? 'm' : 'LF'}</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.pipeSizes.map((p) => (
                    <tr key={p.sizeIn}>
                      <td style={{ fontWeight: 600 }}>{formatPipeSize(p.sizeIn, system)}</td>
                      <td className="text-right">{fmt1(pipeLen(p.totalLF))}</td>
                      <td className="text-right">{formatCurrency(p.directCost)}</td>
                      <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(perLen(p.directPerLF))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-muted" style={{ fontSize: 11, marginTop: 8 }}>
              Sell = direct cost with this bid's markups (section overrides applied). Pipe rows
              cover {metric ? 'm line items with a size-marked description (DN or inches)'
                : 'LF line items with an inch-marked size'} — pipe material and its crew/equipment
              only, not excavation or restoration lines.
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
