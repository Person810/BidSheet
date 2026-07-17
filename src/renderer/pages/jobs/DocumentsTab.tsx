import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { SortableTh, useSortableRows } from '../../components/SortableTable';
import { useToastStore } from '../../stores/toast-store';
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  formatBytes,
  type DocumentCategory,
} from '../../../shared/documentFiles';
import type { AddDocumentsResult, JobDocumentRow } from '../../../shared/types/ipc';

/**
 * Per-job document store: every file related to the job (plans, addenda,
 * sub quotes, photos, contracts) in one place. Files are copied into an
 * app-managed folder, so the originals can move or disappear without
 * breaking the job.
 */
export function DocumentsTab({ jobId, onCountChange }: {
  jobId: number;
  onCountChange?: (count: number) => void;
}) {
  const addToast = useToastStore((s) => s.addToast);
  const [docs, setDocs] = useState<JobDocumentRow[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [addCategory, setAddCategory] = useState<DocumentCategory>('other');
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<{ msg: string; onYes: () => void } | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await window.api.listJobDocuments(jobId);
      setDocs(rows);
      onCountChange?.(rows.length);
    } catch (err: any) {
      addToast(err?.message || 'Failed to load documents.', 'error');
    }
  }, [jobId, onCountChange, addToast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => (categoryFilter === 'all' ? docs : docs.filter((d) => d.category === categoryFilter)),
    [docs, categoryFilter],
  );

  const { sorted, sort, toggleSort } = useSortableRows(filtered, {
    name: (d) => d.filename,
    category: (d) => d.category,
    size: (d) => d.size_bytes,
    added: (d) => d.added_at,
  });

  const reportResult = (result: AddDocumentsResult | null) => {
    if (!result) return; // dialog canceled
    if (result.added > 0) {
      addToast(`Added ${result.added} document${result.added !== 1 ? 's' : ''}.`, 'success');
    }
    if (result.skippedDuplicates > 0) {
      addToast(`Skipped ${result.skippedDuplicates} duplicate${result.skippedDuplicates !== 1 ? 's' : ''} already on this job.`, 'info');
    }
    if (result.failed.length > 0) {
      addToast(`Could not add: ${result.failed.join(', ')}`, 'error');
    }
  };

  const handleAdd = async () => {
    setBusy(true);
    try {
      reportResult(await window.api.addJobDocuments(jobId, addCategory));
      await load();
    } catch (err: any) {
      addToast(err?.message || 'Failed to add documents.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    setBusy(true);
    try {
      const paths = files
        .map((f) => {
          try { return window.api.getDroppedFilePath(f); } catch { return ''; }
        })
        .filter(Boolean);
      if (paths.length === 0) {
        addToast('Could not read the dropped files.', 'error');
        return;
      }
      reportResult(await window.api.addJobDocumentPaths(jobId, paths, addCategory));
      await load();
    } catch (err: any) {
      addToast(err?.message || 'Failed to add documents.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = async (doc: JobDocumentRow) => {
    try {
      await window.api.openJobDocument(doc.id);
    } catch (err: any) {
      addToast(err?.message || 'Failed to open document.', 'error');
    }
  };

  const handleReveal = async (doc: JobDocumentRow) => {
    try {
      await window.api.revealJobDocument(doc.id);
    } catch (err: any) {
      addToast(err?.message || 'Failed to show document.', 'error');
    }
  };

  const handleCategoryChange = async (doc: JobDocumentRow, category: string) => {
    try {
      await window.api.updateJobDocument(doc.id, { category });
      await load();
    } catch (err: any) {
      addToast(err?.message || 'Failed to update document.', 'error');
    }
  };

  const handleDelete = (doc: JobDocumentRow) => {
    setConfirmState({
      msg: `Delete "${doc.filename}" from this job? The copy in BidSheet's document store is removed; your original file (if it still exists) is not touched.`,
      onYes: async () => {
        setConfirmState(null);
        try {
          await window.api.deleteJobDocument(doc.id);
          await load();
        } catch (err: any) {
          addToast(err?.message || 'Failed to delete document.', 'error');
        }
      },
    });
  };

  const formatAdded = (iso: string) => (iso ? iso.slice(0, 10) : '--');

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={handleDrop}
      style={dragOver ? { outline: '2px dashed var(--accent, #4a90d9)', outlineOffset: -2, borderRadius: 8 } : undefined}
    >
      <div className="flex justify-between items-center" style={{ padding: '8px 8px 6px' }}>
        <span className="text-muted" style={{ fontSize: 12 }}>
          {docs.length} document{docs.length !== 1 ? 's' : ''}
          {docs.length > 0 && <> &middot; {formatBytes(docs.reduce((s, d) => s + d.size_bytes, 0))}</>}
          &nbsp;&middot; drag files here or use Add Files
        </span>
        <div className="flex gap-8 items-center no-print">
          <select className="form-control" style={{ width: 130 }} value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="all">All categories</option>
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>{DOCUMENT_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
          <select className="form-control" style={{ width: 130 }} value={addCategory}
            title="Category for newly added files"
            onChange={(e) => setAddCategory(e.target.value as DocumentCategory)}>
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>Add as: {DOCUMENT_CATEGORY_LABELS[c]}</option>
            ))}
          </select>
          <button className="btn btn-sm btn-primary" onClick={handleAdd} disabled={busy}>
            + Add Files
          </button>
        </div>
      </div>

      {docs.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13, padding: '24px 8px', textAlign: 'center' }}>
          No documents yet. Drag files here, or click "+ Add Files" to attach plans,
          addenda, quotes, photos, or anything else that belongs with this job.
        </p>
      ) : (
        <table className="bid-grid">
          <thead>
            <tr>
              <SortableTh label="Name" sortKey="name" sort={sort} onToggle={toggleSort} />
              <SortableTh label="Category" sortKey="category" sort={sort} onToggle={toggleSort} />
              <SortableTh label="Size" sortKey="size" sort={sort} onToggle={toggleSort} className="text-right" />
              <SortableTh label="Added" sortKey="added" sort={sort} onToggle={toggleSort} className="text-right" />
              <th className="no-print" style={{ width: 180 }}></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((doc) => (
              <tr key={doc.id}>
                <td>
                  <span className="material-name-link" onClick={() => handleOpen(doc)} title="Open">
                    {doc.filename}
                  </span>
                </td>
                <td>
                  <select className="form-control" style={{ width: 110, fontSize: 12 }}
                    value={doc.category}
                    onChange={(e) => handleCategoryChange(doc, e.target.value)}>
                    {DOCUMENT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{DOCUMENT_CATEGORY_LABELS[c]}</option>
                    ))}
                  </select>
                </td>
                <td className="text-right">{formatBytes(doc.size_bytes)}</td>
                <td className="text-right">{formatAdded(doc.added_at)}</td>
                <td className="no-print">
                  <div className="flex gap-8 justify-end">
                    <button className="btn btn-sm btn-secondary" onClick={() => handleOpen(doc)}>Open</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => handleReveal(doc)} title="Show in folder">Folder</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => handleDelete(doc)}>&times;</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {confirmState && (
        <ConfirmDialog message={confirmState.msg} onYes={confirmState.onYes}
          onNo={() => setConfirmState(null)} yesLabel="Delete" variant="danger" />
      )}
    </div>
  );
}
