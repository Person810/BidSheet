import React, { useState, useMemo, useRef } from 'react';
import { formatCurrency } from './helpers';
import {
  autoDetectMapping, availableHeaders, parseCsvPrice, ColumnSelect, CsvDropZone,
} from '../../components/csvImport';
import {
  buildAliasIndex, matchQuoteRow, unitsMismatch,
  type AliasEntry, type MatchCandidate, type MatchStatus,
} from '../../../shared/quoteMatching';
import type {
  CsvParseResult, PriceImportContext, PriceImportCommitRow, PriceImportCommitResult,
} from '../../../shared/types/ipc';

// ============================================================
// Column auto-mapping (a quote, not a catalog — see §6 copy)
// ============================================================

const HEADER_ALIASES: Record<string, string[]> = {
  description: ['description', 'item', 'material', 'product', 'name', 'item description', 'desc'],
  price: ['unit price', 'price', 'net price', 'unit cost', 'cost', 'rate', 'ea price', 'net', 'amount', 'extended'],
  unit: ['unit', 'uom', 'u/m', 'um', 'units'],
  partNumber: ['part number', 'part #', 'part#', 'part_number', 'sku', 'item #', 'item#', 'catalog #', 'model', 'mfg #'],
  supplier: ['supplier', 'vendor', 'manufacturer', 'mfg', 'distributor', 'source'],
};

// ============================================================
// Reconciliation row model
// ============================================================

type Action = 'update' | 'create' | 'skip';

interface ReconRow {
  index: number;
  supplier: string;
  description: string;
  unit: string | null;
  price: number | null;
  partNumber: string | null;
  status: MatchStatus;
  method: string | null;
  action: Action;
  targetLineId: number | null;
  ranked: { lineId: number; score: number }[];
}

type Step = 'pick' | 'map' | 'reconcile' | 'done';

const STATUS_META: Record<MatchStatus, { label: string; color: string }> = {
  matched:   { label: 'Matched',   color: 'var(--success)' },
  ambiguous: { label: 'Review',    color: 'var(--warning)' },
  unmatched: { label: 'New',       color: 'var(--accent)' },
};

// ============================================================
// Component
// ============================================================

export function JobPriceImportModal({ jobId, onDone, onClose }: {
  jobId: number;
  onDone: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>('pick');
  const [csv, setCsv] = useState<CsvParseResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>(
    { description: '', price: '', unit: '', partNumber: '', supplier: '' },
  );
  const [defaultSupplier, setDefaultSupplier] = useState('');
  const [ctx, setCtx] = useState<PriceImportContext | null>(null);
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [newSectionId, setNewSectionId] = useState<number | null>(null);
  const [newCategoryId, setNewCategoryId] = useState<number | null>(null);
  // Other jobs (besides this one) the confirmed prices should also flow into.
  const [applyJobIds, setApplyJobIds] = useState<Set<number>>(new Set());
  const [showJobPicker, setShowJobPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<PriceImportCommitResult | null>(null);

  // The import is written the moment `result` lands, so ANY close after that
  // point (Done button, overlay click, Esc) must run the caller's onDone work
  // — refresh + history snapshot — exactly once. Otherwise the grid keeps
  // pre-import prices and a later undo silently wipes the import.
  const doneFired = useRef(false);
  const handleClose = () => {
    if (result && !doneFired.current) {
      doneFired.current = true;
      onDone();
    }
    onClose();
  };

  // Line lookup for rendering old prices / units against the chosen target.
  const lineById = useMemo(() => {
    const m = new Map<number, PriceImportContext['lines'][number]>();
    for (const l of ctx?.lines ?? []) m.set(l.id, l);
    return m;
  }, [ctx]);

  // ---- Step 1: file ----
  const onFileParsed = (parsed: CsvParseResult) => {
    setError(null);
    setCsv(parsed);
    setMapping(autoDetectMapping(parsed.headers, HEADER_ALIASES));
    setStep('map');
  };

  // ---- Step 2 → 3: build reconciliation ----
  const buildReconciliation = async () => {
    if (!csv) return;
    setError(null);
    let context: PriceImportContext;
    try {
      context = await window.api.priceImportContext(jobId);
    } catch (err: any) {
      setError(err.message || 'Failed to load the bid for matching.');
      return;
    }
    setCtx(context);
    setNewSectionId(context.sections[0]?.id ?? null);

    const candidates: MatchCandidate[] = context.lines.map((l) => ({
      lineId: l.id, description: l.description, unit: l.unit, materialId: l.material_id,
      materialName: l.material_name, materialAliases: l.material_aliases,
      materialPartNumber: l.material_part_number,
    }));
    const aliasEntries: AliasEntry[] = context.aliases.map((a) => ({
      supplier: a.supplier, rawDescription: a.raw_description,
      materialId: a.material_id, partNumber: a.part_number,
    }));
    const aliasIndex = buildAliasIndex(aliasEntries);

    const recon: ReconRow[] = csv.rows.map((row, index) => {
      const description = (row[mapping.description] || '').trim();
      const price = parseCsvPrice(mapping.price ? row[mapping.price] : undefined);
      const unit = mapping.unit ? (row[mapping.unit] || '').trim() || null : null;
      const partNumber = mapping.partNumber ? (row[mapping.partNumber] || '').trim() || null : null;
      const supplier = (mapping.supplier ? (row[mapping.supplier] || '').trim() : '') || defaultSupplier.trim();

      const m = matchQuoteRow({ description, unit, partNumber }, supplier, candidates, aliasIndex);
      // Matched/ambiguous default to updating the suggested line; unmatched
      // rows default to creating a new item (the first-class path, §1).
      const action: Action = m.suggestedLineId != null ? 'update' : 'create';
      return {
        index, supplier, description, unit, price, partNumber,
        status: m.status, method: m.method, action,
        targetLineId: m.suggestedLineId, ranked: m.ranked,
      };
    });
    setRows(recon);
    setStep('reconcile');
  };

  // ---- Step 3 editing ----
  const setRowTarget = (index: number, value: string) => {
    setRows((prev) => prev.map((r) => {
      if (r.index !== index) return r;
      if (value === 'skip') return { ...r, action: 'skip', targetLineId: null };
      if (value === 'create') return { ...r, action: 'create', targetLineId: null };
      return { ...r, action: 'update', targetLineId: Number(value) };
    }));
  };

  const stats = useMemo(() => ({
    update: rows.filter((r) => r.action === 'update' && r.targetLineId).length,
    create: rows.filter((r) => r.action === 'create').length,
    skip: rows.filter((r) => r.action === 'skip').length,
    mismatch: rows.filter((r) => r.action === 'update' && r.targetLineId != null
      && unitsMismatch(r.unit, lineById.get(r.targetLineId)?.unit ?? null)).length,
    invalid: rows.filter((r) => r.action !== 'skip' && (r.price == null || !r.description)).length,
  }), [rows, lineById]);

  const toggleJob = (id: number) => setApplyJobIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectAllJobs = () => setApplyJobIds(new Set((ctx?.otherJobs ?? []).map((j) => j.id)));

  const canApply = stats.update + stats.create > 0 && !committing;

  const handleCommit = async () => {
    if (!csv) return;
    setCommitting(true);
    setError(null);
    const source = `Quote: ${csv.fileName}`;
    const payload: PriceImportCommitRow[] = rows.map((r) => ({
      supplier: r.supplier,
      description: r.description,
      unit: r.unit,
      price: r.price ?? 0,
      partNumber: r.partNumber,
      // A row with no usable price/description can't update or create — store
      // it as raw provenance only (skip).
      action: (r.action !== 'skip' && (r.price == null || !r.description)) ? 'skip' : r.action,
      targetLineId: r.action === 'update' ? r.targetLineId : null,
      targetMaterialId: r.action === 'update' && r.targetLineId != null
        ? (lineById.get(r.targetLineId)?.material_id ?? null) : null,
      newCategoryId: r.action === 'create' ? newCategoryId : null,
      newSectionId: r.action === 'create' ? newSectionId : null,
    }));

    try {
      const res = await window.api.priceImportCommit(jobId, {
        source, rows: payload, applyToJobIds: Array.from(applyJobIds),
      });
      setResult(res);
      setStep('done');
    } catch (err: any) {
      setError(err.message || 'Import failed.');
    } finally {
      setCommitting(false);
    }
  };

  // ============================================================
  // Render
  // ============================================================

  const wide = step === 'reconcile';
  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}
        style={{ width: wide ? 1000 : 560, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ marginBottom: 4 }}>
          {step === 'pick' && "Load this job's quote"}
          {step === 'map' && 'Map quote columns'}
          {step === 'reconcile' && 'Review quote against the bid'}
          {step === 'done' && 'Quote imported'}
        </h3>
        {step !== 'done' && (
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 16 }}>
            {step === 'pick' && "Drop a supplier's price quote (CSV/TSV). Nothing is written until you confirm."}
            {step === 'map' && `${csv?.rows.length} rows from ${csv?.fileName}. Match the columns, then set the supplier.`}
            {step === 'reconcile' && 'Each quote row is matched to a bid line. Confirm the targets, then apply. Old and new prices are shown, and unit mismatches are flagged.'}
          </div>
        )}

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid var(--danger)',
            borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#fca5a5' }}>
            {error}
          </div>
        )}

        {/* ---- PICK ---- */}
        {step === 'pick' && (
          <div style={{ padding: '12px 0' }}>
            <CsvDropZone onParsed={onFileParsed} onError={setError}
              hint={<div className="text-muted" style={{ fontSize: 12, marginTop: 12 }}>
                Ask the rep for an Excel quote, save as CSV. Nothing is written until you confirm.
              </div>} />
            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button className="btn btn-secondary" onClick={handleClose}>Cancel</button>
            </div>
          </div>
        )}

        {/* ---- MAP ---- */}
        {step === 'map' && csv && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <ColumnSelect label="Description" required value={mapping.description} options={availableHeaders(csv.headers, mapping, 'description')}
                onChange={(v) => setMapping({ ...mapping, description: v })} />
              <ColumnSelect label="Unit price" required value={mapping.price} options={availableHeaders(csv.headers, mapping, 'price')}
                onChange={(v) => setMapping({ ...mapping, price: v })} />
              <ColumnSelect label="Unit" value={mapping.unit} options={availableHeaders(csv.headers, mapping, 'unit')}
                onChange={(v) => setMapping({ ...mapping, unit: v })} />
              <ColumnSelect label="Part #" value={mapping.partNumber} options={availableHeaders(csv.headers, mapping, 'partNumber')}
                onChange={(v) => setMapping({ ...mapping, partNumber: v })} />
              <ColumnSelect label="Supplier column" value={mapping.supplier} options={availableHeaders(csv.headers, mapping, 'supplier')}
                onChange={(v) => setMapping({ ...mapping, supplier: v })} />
              <div className="form-group">
                <label>Supplier {mapping.supplier ? <span className="text-muted" style={{ fontWeight: 400 }}>(fallback)</span> : <span style={{ color: 'var(--danger)' }}>*</span>}</label>
                <input className="form-control" value={defaultSupplier}
                  onChange={(e) => setDefaultSupplier(e.target.value)}
                  placeholder='e.g. Core & Main' />
              </div>
            </div>
            <div className="text-muted" style={{ fontSize: 11, marginTop: 8 }}>
              The supplier scopes the learned matcher, so next time this supplier's rows auto-match.
            </div>
            <div className="modal-actions" style={{ marginTop: 24 }}>
              <button className="btn btn-secondary" onClick={() => setStep('pick')}>Back</button>
              <button className="btn btn-primary" onClick={buildReconciliation}
                disabled={!mapping.description || !mapping.price || (!mapping.supplier && !defaultSupplier.trim())}>
                Match against bid
              </button>
            </div>
          </div>
        )}

        {/* ---- RECONCILE ---- */}
        {step === 'reconcile' && ctx && (
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 12, fontSize: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <Pill color="var(--success)" text={`${stats.update} update`} />
              <Pill color="var(--accent)" text={`${stats.create} create`} />
              <Pill color="var(--text-muted)" text={`${stats.skip} skip`} />
              {stats.mismatch > 0 && <Pill color="var(--warning)" text={`${stats.mismatch} unit mismatch`} />}
              {stats.invalid > 0 && <Pill color="var(--danger)" text={`${stats.invalid} missing price`} />}
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                <span className="text-muted">New items →</span>
                <select className="form-control" style={{ width: 150, fontSize: 12, padding: '2px 6px' }}
                  value={newSectionId ?? ''} onChange={(e) => setNewSectionId(Number(e.target.value) || null)}>
                  {ctx.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  {ctx.sections.length === 0 && <option value="">(no section, catalog only)</option>}
                </select>
              </span>
            </div>

            {/* Apply to other jobs (§ multi-job price update) */}
            {ctx.otherJobs.length > 0 && (
              <div style={{ marginBottom: 12, fontSize: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="text-muted">Apply prices to:</span>
                  <strong>{applyJobIds.size > 0 ? `This job + ${applyJobIds.size} other` : 'This job only'}</strong>
                  <button className="bid-grid-inline-action" onClick={() => setShowJobPicker((v) => !v)}>
                    {showJobPicker ? 'done' : 'choose other jobs…'}
                  </button>
                </div>
                {showJobPicker && (
                  <div className="card" style={{ marginTop: 6, padding: 10, maxHeight: 168, overflowY: 'auto' }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <button className="btn btn-sm btn-secondary" onClick={selectAllJobs}>Select all open jobs</button>
                      <button className="btn btn-sm btn-secondary" onClick={() => setApplyJobIds(new Set())}>Clear</button>
                    </div>
                    {ctx.otherJobs.map((j) => (
                      <label key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', cursor: 'pointer' }}>
                        <input type="checkbox" checked={applyJobIds.has(j.id)} onChange={() => toggleJob(j.id)} />
                        <span>{j.name}{j.job_number ? ` (#${j.job_number})` : ''}</span>
                        <span className="text-muted" style={{ fontSize: 11 }}>{j.status}</span>
                      </label>
                    ))}
                  </div>
                )}
                <div className="text-muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Only matched catalog items propagate; each job keeps its own quantities. Locked/won bids are excluded.
                </div>
              </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              <table className="data-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ width: 70 }}>Match</th>
                    <th>Quote row</th>
                    <th style={{ width: 280 }}>Target</th>
                    <th className="text-right" style={{ width: 90 }}>Old</th>
                    <th className="text-right" style={{ width: 90 }}>New</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const target = r.targetLineId != null ? lineById.get(r.targetLineId) : null;
                    const oldPrice = r.action === 'update' && target ? target.material_unit_cost : null;
                    const mismatch = r.action === 'update' && target
                      ? unitsMismatch(r.unit, target.unit) : false;
                    const sm = STATUS_META[r.status];
                    const diff = oldPrice != null && r.price != null ? r.price - oldPrice : null;
                    return (
                      <tr key={r.index} style={r.action === 'skip' ? { opacity: 0.5 } : undefined}>
                        <td>
                          <span style={{ fontSize: 11, fontWeight: 600, color: sm.color }}>{sm.label}</span>
                          {r.method && <div className="text-muted" style={{ fontSize: 10 }}>{r.method}</div>}
                        </td>
                        <td>
                          <div style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.description || <span className="text-muted">(no description)</span>}
                          </div>
                          <div className="text-muted" style={{ fontSize: 10 }}>
                            {r.supplier || 'no supplier'}{r.unit ? ` · ${r.unit}` : ''}
                            {r.partNumber ? ` · ${r.partNumber}` : ''}
                          </div>
                        </td>
                        <td>
                          <select className="form-control" style={{ fontSize: 12, padding: '2px 6px', width: '100%' }}
                            value={r.action === 'update' && r.targetLineId != null ? String(r.targetLineId) : r.action}
                            onChange={(e) => setRowTarget(r.index, e.target.value)}>
                            <option value="create">➕ Create new item</option>
                            <option value="skip">Skip (keep as record only)</option>
                            <optgroup label="Update bid line">
                              {ctx.lines.map((l) => (
                                <option key={l.id} value={String(l.id)}>
                                  {l.description.slice(0, 48)} ({l.unit}) @ {formatCurrency(l.material_unit_cost)}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                          {mismatch && (
                            <div style={{ fontSize: 10, color: 'var(--warning)', marginTop: 2 }}>
                              ⚠ unit mismatch: quote {r.unit} ≠ line {target?.unit}, not converted, confirm
                            </div>
                          )}
                        </td>
                        <td className="text-right">{oldPrice != null ? formatCurrency(oldPrice) : '—'}</td>
                        <td className="text-right" style={{ fontWeight: 600 }}>
                          {r.price != null ? formatCurrency(r.price)
                            : <span style={{ color: 'var(--danger)' }}>—</span>}
                          {diff != null && diff !== 0 && (
                            <div style={{ fontSize: 10, fontWeight: 400,
                              color: diff > 0 ? 'var(--danger)' : 'var(--success)' }}>
                              {diff > 0 ? '+' : ''}{formatCurrency(diff)}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="modal-actions" style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <button className="btn btn-secondary" onClick={() => setStep('map')}>Back</button>
              <div style={{ flex: 1 }} />
              <div className="text-muted" style={{ fontSize: 12, marginRight: 8, alignSelf: 'center' }}>
                {stats.update + stats.create} change{stats.update + stats.create !== 1 ? 's' : ''} will be written
              </div>
              <button className="btn btn-primary" onClick={handleCommit} disabled={!canApply}>
                {committing ? 'Applying…' : 'Confirm & apply'}
              </button>
            </div>
          </div>
        )}

        {/* ---- DONE ---- */}
        {step === 'done' && result && (
          <div style={{ padding: '16px 0' }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 36, marginBottom: 6 }}>&#10003;</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                {result.stateCounts.quoted + result.stateCounts.confirmed} of {result.stateCounts.total} items now on quoted prices
                {result.stateCounts.seed > 0 ? ` · ${result.stateCounts.seed} still on seed` : ''}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 20 }}>
              <Stat n={result.updatedLines} label="Lines repriced" color="var(--success)" />
              <Stat n={result.createdItems} label="Items created" color="var(--accent)" />
              <Stat n={result.catalogUpdates} label="Catalog prices" color="var(--text-secondary)" />
            </div>
            {result.propagatedLines > 0 && (
              <div style={{ fontSize: 13, textAlign: 'center', marginBottom: 16, color: 'var(--text-secondary)' }}>
                Also repriced {result.propagatedLines} line{result.propagatedLines !== 1 ? 's' : ''} across{' '}
                {result.propagatedJobs} other job{result.propagatedJobs !== 1 ? 's' : ''}.
              </div>
            )}
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 20 }}>
              {result.rawStored} quote row{result.rawStored !== 1 ? 's' : ''} stored as a permanent record. Every
              catalog price change was logged to price history.
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={handleClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- small presentational helpers ----

function Pill({ color, text }: { color: string; text: string }) {
  return (
    <span style={{ padding: '4px 10px', borderRadius: 6, background: 'var(--bg-tertiary)', color }}>{text}</span>
  );
}

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: 16, textAlign: 'center' }}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{n}</div>
      <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{label}</div>
    </div>
  );
}
