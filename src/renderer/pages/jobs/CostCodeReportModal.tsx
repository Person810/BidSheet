import React, { useMemo } from 'react';
import { formatCurrency } from './helpers';
import { useToastStore } from '../../stores/toast-store';
import { neutralizeCsvFormula } from '../../../shared/csvSafe';
import { dismissOnEscOnly } from '../../components/modalDismiss';

interface CodeRollup {
  code: string;
  material: number;
  labor: number;
  equipment: number;
  sub: number;
  total: number;
  itemCount: number;
}

function csvEscape(value: string | number): string {
  const s = neutralizeCsvFormula(String(value));
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Direct-cost roll-up by cost code across the whole job (alternates included,
 * flagged in the footnote). Untagged items group under "(no cost code)".
 */
export function CostCodeReportModal({ job, sections, lineItems, onClose }: {
  job: any;
  sections: any[];
  lineItems: Record<number, any[]>;
  onClose: () => void;
}) {
  const addToast = useToastStore((s) => s.addToast);

  const { rollups, totals, hasAlternates } = useMemo(() => {
    const map = new Map<string, CodeRollup>();
    let hasAlt = false;
    for (const section of sections) {
      if (section.is_alternate === 1) hasAlt = true;
      for (const item of lineItems[section.id] || []) {
        const code = (item.cost_code || '').trim() || '(no cost code)';
        const r = map.get(code) || { code, material: 0, labor: 0, equipment: 0, sub: 0, total: 0, itemCount: 0 };
        r.material += item.material_total || 0;
        r.labor += item.labor_total || 0;
        r.equipment += item.equipment_total || 0;
        r.sub += item.subcontractor_cost || 0;
        r.total += item.total_cost || 0;
        r.itemCount += 1;
        map.set(code, r);
      }
    }
    const rows = Array.from(map.values()).sort((a, b) =>
      a.code === '(no cost code)' ? 1 : b.code === '(no cost code)' ? -1 : a.code.localeCompare(b.code)
    );
    const t = rows.reduce((acc, r) => ({
      material: acc.material + r.material, labor: acc.labor + r.labor,
      equipment: acc.equipment + r.equipment, sub: acc.sub + r.sub, total: acc.total + r.total,
    }), { material: 0, labor: 0, equipment: 0, sub: 0, total: 0 });
    return { rollups: rows, totals: t, hasAlternates: hasAlt };
  }, [sections, lineItems]);

  const handleExport = async () => {
    const lines: string[] = [];
    lines.push('﻿' + ['Cost Code', 'Items', 'Material', 'Labor', 'Equipment', 'Subcontractor', 'Direct Cost', '% of Direct'].map(csvEscape).join(','));
    for (const r of rollups) {
      lines.push([
        r.code, r.itemCount, r.material.toFixed(2), r.labor.toFixed(2),
        r.equipment.toFixed(2), r.sub.toFixed(2), r.total.toFixed(2),
        totals.total > 0 ? ((r.total / totals.total) * 100).toFixed(1) : '0',
      ].map(csvEscape).join(','));
    }
    lines.push(['TOTAL', '', totals.material.toFixed(2), totals.labor.toFixed(2),
      totals.equipment.toFixed(2), totals.sub.toFixed(2), totals.total.toFixed(2), '100'].map(csvEscape).join(','));

    const safeName = (job.job_number || job.name || 'job').replace(/[^a-zA-Z0-9_-]/g, '_');
    try {
      const result = await window.api.saveCsv(
        `${safeName}-cost-codes.csv`, 'Export Cost Code Report', lines.join('\r\n') + '\r\n',
      );
      if (result?.success) addToast(`Cost code report saved to ${result.path}`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Export failed', 'error');
    }
  };

  return (
    <div className="modal-overlay" onClick={dismissOnEscOnly(onClose)}>
      <div className="modal" style={{ maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Cost Code Summary</h3>
          <button className="btn btn-sm btn-secondary" onClick={handleExport} disabled={rollups.length === 0}>
            Export CSV
          </button>
        </div>

        {rollups.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13 }}>
            No line items yet. Tag line items with cost codes to see the roll-up here.
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Cost Code</th>
                <th className="text-right">Items</th>
                <th className="text-right">Material</th>
                <th className="text-right">Labor</th>
                <th className="text-right">Equipment</th>
                <th className="text-right">Sub</th>
                <th className="text-right">Direct Cost</th>
                <th className="text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {rollups.map((r) => (
                <tr key={r.code}>
                  <td style={{ fontWeight: r.code === '(no cost code)' ? 400 : 600,
                    color: r.code === '(no cost code)' ? 'var(--text-muted)' : undefined }}>
                    {r.code}
                  </td>
                  <td className="text-right">{r.itemCount}</td>
                  <td className="text-right">{formatCurrency(r.material)}</td>
                  <td className="text-right">{formatCurrency(r.labor)}</td>
                  <td className="text-right">{formatCurrency(r.equipment)}</td>
                  <td className="text-right">{formatCurrency(r.sub)}</td>
                  <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(r.total)}</td>
                  <td className="text-right text-muted">
                    {totals.total > 0 ? ((r.total / totals.total) * 100).toFixed(1) : '0'}%
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ fontWeight: 700 }}>TOTAL</td>
                <td></td>
                <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(totals.material)}</td>
                <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(totals.labor)}</td>
                <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(totals.equipment)}</td>
                <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(totals.sub)}</td>
                <td className="text-right" style={{ fontWeight: 700, color: 'var(--accent)' }}>{formatCurrency(totals.total)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
        <p className="text-muted" style={{ fontSize: 11, marginTop: 8 }}>
          Direct costs only (no markups){hasAlternates ? '; alternate sections included' : ''}.
        </p>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
