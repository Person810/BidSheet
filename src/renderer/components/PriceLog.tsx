import React, { useEffect, useMemo, useState } from 'react';
import { formatCurrency } from '../utils/format';
import { dismissOnEscOnly } from './modalDismiss';
import type { PriceLogEntry, PriceLogKind } from '../../shared/types/ipc';

const KIND_LABELS: Record<PriceLogKind, string> = {
  material: 'Material',
  labor_role: 'Labor',
  equipment: 'Equipment',
};

const FIELD_LABELS: Record<string, string> = {
  default_unit_cost: 'Unit cost',
  default_hourly_rate: 'Base rate/hr',
  burden_multiplier: 'Burden',
  hourly_rate: 'Hourly rate',
  daily_rate: 'Daily rate',
  mobilization_cost: 'Mobilization',
};

function fmtValue(field: string, v: number | null): string {
  if (v == null) return '--';
  return field === 'burden_multiplier' ? `${v.toFixed(2)}x` : formatCurrency(v);
}

/** Log timestamps are SQLite 'localtime' strings — local wall time, not UTC. */
function fmtWhen(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return s;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).toLocaleString([], {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function change(e: PriceLogEntry): { text: string; color?: string } {
  if (e.oldValue == null || e.newValue == null || e.oldValue === 0) return { text: '' };
  const pct = ((e.newValue - e.oldValue) / Math.abs(e.oldValue)) * 100;
  const text = `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
  return { text, color: pct > 0 ? 'var(--danger, #ef4444)' : 'var(--success, #22c55e)' };
}

/** Rows of the pricing audit log. `showItem` adds the item/type columns. */
export function PriceLogTable({ entries, showItem = true }: { entries: PriceLogEntry[]; showItem?: boolean }) {
  if (entries.length === 0) {
    return <p className="text-muted" style={{ fontSize: 13 }}>No price changes recorded yet.</p>;
  }
  return (
    <table className="data-table" style={{ fontSize: 12 }}>
      <thead>
        <tr>
          <th>When</th>
          {showItem && <th>Type</th>}
          {showItem && <th>Item</th>}
          <th>Field</th>
          <th className="text-right">Was</th>
          <th className="text-right">Now</th>
          <th className="text-right">Change</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e, i) => {
          const c = change(e);
          return (
            <tr key={i}>
              <td style={{ whiteSpace: 'nowrap' }}>{fmtWhen(e.changedAt)}</td>
              {showItem && <td>{KIND_LABELS[e.kind]}</td>}
              {showItem && <td>{e.itemName}</td>}
              <td>{FIELD_LABELS[e.field] ?? e.field}</td>
              <td className="text-right">{fmtValue(e.field, e.oldValue)}</td>
              <td className="text-right" style={{ fontWeight: 600 }}>{fmtValue(e.field, e.newValue)}</td>
              <td className="text-right" style={{ color: c.color }}>{c.text}</td>
              <td className="text-muted">{e.source}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * The whole pricing audit log (materials, labor rates, equipment rates),
 * newest first, filterable by type and item name.
 */
export function PriceLogModal({ initialKind, onClose }: { initialKind?: PriceLogKind; onClose: () => void }) {
  const [kind, setKind] = useState<PriceLogKind | 'all'>(initialKind ?? 'all');
  const [entries, setEntries] = useState<PriceLogEntry[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    window.api.getPriceLog({ kind: kind === 'all' ? undefined : kind, limit: 2000 })
      .then(setEntries)
      .catch((err: unknown) => console.error('Failed to load price log:', err));
  }, [kind]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? entries.filter((e) => e.itemName.toLowerCase().includes(q)) : entries;
  }, [entries, search]);

  return (
    // The overlay's onClick is how Esc closes this dialog, not a mouse
    // affordance: App.tsx's global Esc handler dispatches a synthetic click
    // here and dismissOnEscOnly lets only that through (see modalDismiss.ts).
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div className="modal-overlay" onClick={dismissOnEscOnly(onClose)}>
      {/* No stopPropagation needed: dismissOnEscOnly ignores anything that
          didn't originate on the overlay itself. */}
      <div className="modal" style={{ maxWidth: 900, width: '90vw' }}>
        <h3>Price Change Log</h3>
        <p className="text-muted" style={{ fontSize: 12, marginTop: -4 }}>
          Every change to a material price, labor rate or equipment rate on this computer, including
          CSV imports and changes synced from other computers.
        </p>
        <div className="flex gap-8 items-center" style={{ margin: '8px 0 12px' }}>
          <select className="form-control" style={{ width: 160 }} value={kind} aria-label="Filter by type"
            onChange={(e) => setKind(e.target.value as PriceLogKind | 'all')}>
            <option value="all">All types</option>
            <option value="material">Materials</option>
            <option value="labor_role">Labor</option>
            <option value="equipment">Equipment</option>
          </select>
          <input type="text" className="form-control" placeholder="Search items..." style={{ width: 240 }}
            value={search} onChange={(e) => setSearch(e.target.value)} />
          <span className="text-muted" style={{ fontSize: 12 }}>{shown.length} change{shown.length !== 1 ? 's' : ''}</span>
        </div>
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          <PriceLogTable entries={shown} />
        </div>
        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
