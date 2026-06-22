import React, { useMemo, useState } from 'react';
import { useToastStore } from '../../stores/toast-store';
import { parseImportQuantity } from './helpers';

interface BidItemImportModalProps {
  jobId: number;
  sections: { id: number; name: string }[];
  onDone: () => void;
  onClose: () => void;
}

const FIELD_ALIASES: Record<string, string[]> = {
  itemNumber: ['item no', 'item no.', 'item number', 'item #', 'item#', 'pay item', 'pay item no', 'line no', 'line no.', 'line', 'no.', 'no', 'item'],
  description: ['description', 'item description', 'pay item description', 'desc', 'work description', 'bid item description'],
  quantity: ['quantity', 'qty', 'approx quantity', 'approx. quantity', 'approximate quantity', 'estimated quantity', 'est qty', 'plan quantity', 'bid quantity'],
  unit: ['unit', 'units', 'uom', 'unit of measure', 'um'],
};

function autoDetect(headers: string[]): Record<string, string> {
  const lower = headers.map((h) => h.toLowerCase().trim());
  const mapping: Record<string, string> = { itemNumber: '', description: '', quantity: '', unit: '' };
  const claimed = new Set<string>();
  for (const field of ['description', 'quantity', 'unit', 'itemNumber']) {
    for (const alias of FIELD_ALIASES[field]) {
      const idx = lower.indexOf(alias);
      if (idx !== -1 && !claimed.has(headers[idx])) {
        mapping[field] = headers[idx];
        claimed.add(headers[idx]);
        break;
      }
    }
  }
  return mapping;
}

/**
 * Scaffold a bid from an owner's bid schedule (DOT/municipal bid forms are
 * almost always published as a spreadsheet). Items import unpriced — the
 * estimator prices them in the grid afterward.
 */
export function BidItemImportModal({ jobId, sections, onDone, onClose }: BidItemImportModalProps) {
  const addToast = useToastStore((s) => s.addToast);
  const [csv, setCsv] = useState<{ headers: string[]; rows: Record<string, string>[]; fileName: string } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({ itemNumber: '', description: '', quantity: '', unit: '' });
  const [targetSectionId, setTargetSectionId] = useState<number | 'new'>('new');
  const [newSectionName, setNewSectionName] = useState('Bid Schedule');
  const [importing, setImporting] = useState(false);

  const pickFile = async () => {
    try {
      const result = await window.api.openCsvFile();
      if (!result) return;
      if (result.error) {
        addToast(result.error, 'error');
        return;
      }
      setCsv(result);
      setMapping(autoDetect(result.headers));
    } catch (err: any) {
      addToast(err?.message || 'Could not read that file.', 'error');
    }
  };

  const items = useMemo(() => {
    if (!csv || !mapping.description) return [];
    return csv.rows
      .map((row) => ({
        itemNumber: mapping.itemNumber ? (row[mapping.itemNumber] || '').trim() || null : null,
        description: (row[mapping.description] || '').trim(),
        quantity: parseImportQuantity(mapping.quantity ? row[mapping.quantity] : ''),
        unit: mapping.unit ? (row[mapping.unit] || '').trim().toUpperCase() || 'EA' : 'EA',
      }))
      .filter((it) => it.description.length > 0);
  }, [csv, mapping]);

  const handleImport = async () => {
    if (items.length === 0) return;
    setImporting(true);
    try {
      let sectionId: number;
      if (targetSectionId === 'new') {
        const created = await window.api.saveBidSection({
          jobId, name: newSectionName.trim() || 'Bid Schedule', sortOrder: sections.length,
        });
        sectionId = created.id;
      } else {
        sectionId = targetSectionId;
      }
      const result = await window.api.importBidItems(jobId, sectionId, items);
      addToast(`Imported ${result.imported} bid item${result.imported !== 1 ? 's' : ''}. Price them in the grid.`, 'success');
      onDone();
      onClose();
    } catch (err: any) {
      addToast(err?.message || 'Import failed.', 'error');
    } finally {
      setImporting(false);
    }
  };

  const mapSelect = (field: string, label: string, required = false) => (
    <div className="form-group">
      <label className="form-label">{label}{required ? ' *' : ''}</label>
      <select className="form-control" value={mapping[field]}
        onChange={(e) => setMapping({ ...mapping, [field]: e.target.value })}>
        <option value="">(not in file)</option>
        {csv!.headers.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
        <h3>Import Bid Items</h3>
        <p className="text-muted" style={{ fontSize: 12, marginBottom: 14 }}>
          Load the owner's bid schedule (CSV) to scaffold line items. Item numbers,
          descriptions, quantities, and units come in unpriced.
        </p>

        {!csv ? (
          <button className="btn btn-primary" onClick={pickFile}>Choose CSV File…</button>
        ) : (
          <>
            <p style={{ fontSize: 12, marginBottom: 10 }}>
              <strong>{csv.fileName}</strong>
              <span className="text-muted"> ({csv.rows.length} rows)</span>
              <button className="bid-grid-inline-action" style={{ marginLeft: 10 }} onClick={pickFile}>change file</button>
            </p>

            <div className="form-row">
              {mapSelect('itemNumber', 'Item No.')}
              {mapSelect('description', 'Description', true)}
              {mapSelect('quantity', 'Quantity')}
              {mapSelect('unit', 'Unit')}
            </div>

            <div className="form-row">
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Import Into</label>
                <select className="form-control" value={targetSectionId}
                  onChange={(e) => setTargetSectionId(e.target.value === 'new' ? 'new' : Number(e.target.value))}>
                  <option value="new">New section…</option>
                  {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              {targetSectionId === 'new' && (
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">New Section Name</label>
                  <input className="form-control" value={newSectionName}
                    onChange={(e) => setNewSectionName(e.target.value)} />
                </div>
              )}
            </div>

            {mapping.description ? (
              <>
                <p style={{ fontSize: 12, margin: '6px 0' }}>
                  {items.length} item{items.length !== 1 ? 's' : ''} ready
                  {csv.rows.length !== items.length && (
                    <span className="text-muted"> ({csv.rows.length - items.length} rows without a description skipped)</span>
                  )}
                </p>
                <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                  <table className="data-table" style={{ marginBottom: 0 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 80 }}>Item No.</th>
                        <th>Description</th>
                        <th className="text-right" style={{ width: 90 }}>Quantity</th>
                        <th style={{ width: 60 }}>Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.slice(0, 50).map((it, i) => (
                        <tr key={i}>
                          <td className="text-muted">{it.itemNumber || '--'}</td>
                          <td>{it.description}</td>
                          <td className="text-right">{it.quantity.toLocaleString()}</td>
                          <td>{it.unit}</td>
                        </tr>
                      ))}
                      {items.length > 50 && (
                        <tr><td colSpan={4} className="text-muted" style={{ textAlign: 'center' }}>
                          … and {items.length - 50} more
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="text-muted" style={{ fontSize: 12 }}>Pick the Description column to preview.</p>
            )}
          </>
        )}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleImport}
            disabled={importing || items.length === 0 || (targetSectionId === 'new' && !newSectionName.trim())}>
            {importing ? 'Importing…' : `Import ${items.length || ''} Item${items.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
