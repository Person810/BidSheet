import React, { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatCurrency } from './helpers';
import { useToastStore } from '../../stores/toast-store';
import { dismissOnEscOnly } from '../../components/modalDismiss';

interface TemplateRow {
  id: number;
  name: string;
  created_at: string;
  item_count: number;
  direct_cost_total: number;
}

/**
 * Insert a saved section template into this job. Templates are created
 * from a section's settings ("Save as Template") and carry the section's
 * line items; snapshot prices come in flagged as past prices so the
 * price-state system tells the truth about their age.
 */
export function SectionTemplatePickerModal({ jobId, onInserted, onClose }: {
  jobId: number;
  onInserted: () => Promise<void> | void;
  onClose: () => void;
}) {
  const addToast = useToastStore((s) => s.addToast);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setTemplates(await window.api.getSectionTemplates());
    } catch (err: any) {
      addToast(err?.message || 'Failed to load templates.', 'error');
    }
  }, [addToast]);

  useEffect(() => { load(); }, [load]);

  const handleInsert = async (t: TemplateRow) => {
    setBusy(true);
    try {
      const result = await window.api.insertSectionTemplate(t.id, jobId);
      addToast(`Added "${t.name}" (${result.itemCount} items). Check quantities and prices for this job.`, 'success');
      await onInserted();
      onClose();
    } catch (err: any) {
      addToast(err?.message || 'Failed to insert template.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    setConfirmDeleteId(null);
    try {
      await window.api.deleteSectionTemplate(id);
      await load();
    } catch (err: any) {
      addToast(err?.message || 'Failed to delete template.', 'error');
    }
  };

  return (
    <div className="modal-overlay" onClick={dismissOnEscOnly(onClose)}>
      <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: 4 }}>Section Templates</h3>
        <p className="text-muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Standard packages saved from past bids. To create one, open a section's
          settings and click "Save as Template".
        </p>

        {templates.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, padding: '16px 0' }}>
            No templates yet.
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="text-right">Items</th>
                <th className="text-right">Direct Cost</th>
                <th className="text-right">Saved</th>
                <th style={{ width: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td className="text-right">{t.item_count}</td>
                  <td className="text-right">{formatCurrency(t.direct_cost_total)}</td>
                  <td className="text-right text-muted">{t.created_at ? t.created_at.slice(0, 10) : '--'}</td>
                  <td>
                    <div className="flex gap-8 justify-end">
                      <button className="btn btn-sm btn-primary" onClick={() => handleInsert(t)} disabled={busy}>
                        Insert
                      </button>
                      <button className="btn btn-sm btn-secondary" onClick={() => setConfirmDeleteId(t.id)}>&times;</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>

        {confirmDeleteId !== null && (
          <ConfirmDialog message="Delete this template? Jobs that used it are not affected."
            onYes={() => handleDelete(confirmDeleteId)}
            onNo={() => setConfirmDeleteId(null)} yesLabel="Delete" variant="danger" />
        )}
      </div>
    </div>
  );
}
