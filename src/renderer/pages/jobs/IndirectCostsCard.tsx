import React, { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatCurrency } from './helpers';
import { useToastStore } from '../../stores/toast-store';
import type { IndirectCostRow } from '../../../shared/types/ipc';

/**
 * Job-level indirect costs: mobilization, traffic control, dewatering,
 * trailers, superintendent time — entered once instead of faked as line
 * items. The pool joins the bid summary before markups (bidCalc applies
 * job-level OH/profit/bond on top; tax and escalation don't apply).
 */
export function IndirectCostsCard({ jobId, isLocked, onChanged }: {
  jobId: number;
  isLocked: boolean;
  onChanged: () => void;
}) {
  const addToast = useToastStore((s) => s.addToast);
  const [rows, setRows] = useState<IndirectCostRow[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [draftDesc, setDraftDesc] = useState('');
  const [draftAmount, setDraftAmount] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await window.api.getIndirectCosts(jobId));
    } catch (err: any) {
      addToast(err?.message || 'Failed to load indirect costs.', 'error');
    }
  }, [jobId, addToast]);

  useEffect(() => { load(); }, [load]);

  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);

  const startAdd = () => {
    setDraftDesc('');
    setDraftAmount(0);
    setEditingId('new');
    setExpanded(true);
  };

  const startEdit = (r: IndirectCostRow) => {
    setDraftDesc(r.description);
    setDraftAmount(r.amount);
    setEditingId(r.id);
  };

  const save = async () => {
    if (!draftDesc.trim()) return;
    try {
      await window.api.saveIndirectCost({
        id: editingId === 'new' ? undefined : (editingId as number),
        jobId,
        description: draftDesc.trim(),
        amount: draftAmount,
        sortOrder: editingId === 'new' ? rows.length : undefined,
      });
      setEditingId(null);
      await load();
      onChanged();
    } catch (err: any) {
      addToast(err?.message || 'Failed to save indirect cost.', 'error');
    }
  };

  const doDelete = async (id: number) => {
    setConfirmDeleteId(null);
    try {
      await window.api.deleteIndirectCost(id);
      await load();
      onChanged();
    } catch (err: any) {
      addToast(err?.message || 'Failed to delete indirect cost.', 'error');
    }
  };

  const editorRow = (
    <tr>
      <td>
        <input type="text" className="form-control" value={draftDesc} autoFocus
          placeholder="e.g. Mobilization, Traffic Control, Dewatering"
          onChange={(e) => setDraftDesc(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditingId(null); }} />
      </td>
      <td className="text-right" style={{ width: 140 }}>
        <input type="number" className="form-control text-right" value={draftAmount} step="100" min="0"
          onChange={(e) => setDraftAmount(parseFloat(e.target.value) || 0)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditingId(null); }} />
      </td>
      <td className="no-print" style={{ width: 120 }}>
        <div className="flex gap-8 justify-end">
          <button className="btn btn-sm btn-primary" onClick={save} disabled={!draftDesc.trim()}>Save</button>
          <button className="btn btn-sm btn-secondary" onClick={() => setEditingId(null)}>Cancel</button>
        </div>
      </td>
    </tr>
  );

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="flex justify-between items-center">
        <span style={{ fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          onClick={() => setExpanded(!expanded)}
          title="Job-level costs that aren't tied to a line item. Markups apply on top; tax and escalation do not.">
          {expanded ? '▾' : '▸'} Indirect Costs
          {rows.length > 0 && (
            <span className="text-muted" style={{ fontWeight: 400, marginLeft: 8 }}>
              {rows.length} item{rows.length !== 1 ? 's' : ''} · {formatCurrency(total)}
            </span>
          )}
        </span>
        {!isLocked && (
          <button className="btn btn-sm btn-secondary no-print" onClick={startAdd}>+ Indirect Cost</button>
        )}
      </div>

      {expanded && (
        rows.length === 0 && editingId !== 'new' ? (
          <p className="text-muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
            Mobilization, traffic control, dewatering, trailers — costs that belong to the whole
            job. They join the bid before markups instead of being faked as line items.
          </p>
        ) : (
          <table className="data-table" style={{ marginTop: 8 }}>
            <tbody>
              {rows.map((r) => (
                editingId === r.id ? (
                  <React.Fragment key={r.id}>{editorRow}</React.Fragment>
                ) : (
                  <tr key={r.id}>
                    <td>
                      {isLocked ? r.description : (
                        <span className="material-name-link" onClick={() => startEdit(r)}>{r.description}</span>
                      )}
                    </td>
                    <td className="text-right" style={{ width: 140 }}>{formatCurrency(r.amount)}</td>
                    <td className="no-print" style={{ width: 120 }}>
                      {!isLocked && (
                        <div className="flex gap-8 justify-end">
                          <button className="btn btn-sm btn-secondary" onClick={() => startEdit(r)}>Edit</button>
                          <button className="btn btn-sm btn-secondary" onClick={() => setConfirmDeleteId(r.id)}>&times;</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              ))}
              {editingId === 'new' && editorRow}
              {rows.length > 0 && (
                <tr>
                  <td style={{ fontWeight: 600 }}>Total</td>
                  <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(total)}</td>
                  <td className="no-print"></td>
                </tr>
              )}
            </tbody>
          </table>
        )
      )}

      {confirmDeleteId !== null && (
        <ConfirmDialog message="Delete this indirect cost?" onYes={() => doDelete(confirmDeleteId)}
          onNo={() => setConfirmDeleteId(null)} yesLabel="Delete" variant="danger" />
      )}
    </div>
  );
}
