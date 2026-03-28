import React, { useState, useEffect, useMemo } from 'react';

// ============================================================
// Types
// ============================================================

interface CsvRow {
  [key: string]: string;
}

interface ParsedCsv {
  headers: string[];
  rows: CsvRow[];
  fileName: string;
}

interface ExistingMaterial {
  id: number;
  name: string;
  default_unit_cost: number;
  supplier: string | null;
  part_number: string | null;
  unit: string;
  category_id: number;
}

// A row ready for preview after column mapping + matching
interface PreviewRow {
  csvIndex: number;
  csvName: string;           // raw name from CSV
  csvUnitCost: number | null;
  csvSupplier: string;
  csvPartNumber: string;
  matchedMaterial: ExistingMaterial | null;
  matchMethod: 'name' | 'part_number' | null;
  priceChanged: boolean;
  included: boolean;         // user can uncheck rows
}

type ImportStep = 'pick' | 'map' | 'preview' | 'done';

// Well-known header aliases for auto-mapping
const HEADER_ALIASES: Record<string, string[]> = {
  name: ['name', 'material', 'item', 'description', 'product', 'material name', 'item name', 'product name'],
  unitCost: ['unit cost', 'unit price', 'price', 'cost', 'rate', 'unit_cost', 'unit_price', 'unitcost', 'unitprice', 'amount'],
  supplier: ['supplier', 'vendor', 'source', 'manufacturer', 'mfg', 'distributor'],
  partNumber: ['part number', 'part #', 'part#', 'part_number', 'partnumber', 'sku', 'item #', 'item#', 'catalog #', 'catalog#', 'model', 'item number'],
};

function autoDetectMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {
    name: '',
    unitCost: '',
    supplier: '',
    partNumber: '',
  };

  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
  const claimed = new Set<string>();

  // Map in priority order: name first, then unitCost, etc.
  for (const field of ['name', 'unitCost', 'supplier', 'partNumber']) {
    for (const alias of HEADER_ALIASES[field]) {
      const idx = lowerHeaders.indexOf(alias);
      if (idx !== -1 && !claimed.has(headers[idx])) {
        mapping[field] = headers[idx];
        claimed.add(headers[idx]);
        break;
      }
    }
  }

  return mapping;
}

// ============================================================
// Component
// ============================================================

export function CsvImportModal({
  onComplete,
  onClose,
}: {
  onComplete: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<ImportStep>('pick');
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [allMaterials, setAllMaterials] = useState<ExistingMaterial[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({
    name: '',
    unitCost: '',
    supplier: '',
    partNumber: '',
  });
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ updated: number; skipped: number; unmatched: number } | null>(null);
  const [showUnmatchedOnly, setShowUnmatchedOnly] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragCounter = React.useRef(0);

  // Load ALL materials on mount (ignores category filter from parent)
  useEffect(() => {
    window.api.getMaterials().then((mats: ExistingMaterial[]) => setAllMaterials(mats));
  }, []);

  // Columns already claimed by another field (prevents double-mapping)
  const usedColumns = useMemo(() => {
    const used = new Set<string>();
    for (const val of Object.values(mapping)) {
      if (val) used.add(val);
    }
    return used;
  }, [mapping]);

  // Returns the CSV headers available for a given field's dropdown.
  // Always includes the currently selected value + unassigned headers.
  const availableHeaders = (field: string): string[] => {
    if (!csv) return [];
    return csv.headers.filter((h) => !usedColumns.has(h) || mapping[field] === h);
  };

  // Shared: handle parsed CSV result from either dialog or drag-and-drop
  const handleParsedCsv = (parsed: any) => {
    if (!parsed) return;
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    if (parsed.rows.length === 0) {
      setError('The CSV file is empty (no data rows found).');
      return;
    }
    setCsv(parsed);
    setMapping(autoDetectMapping(parsed.headers));
    setStep('map');
  };

  // ---- Step 1: Pick file (dialog) ----
  const handlePickFile = async () => {
    setError(null);
    try {
      const parsed = await window.api.openCsvFile();
      handleParsedCsv(parsed);
    } catch (err: any) {
      setError(err.message || 'Failed to open file.');
    }
  };

  // ---- Step 1: Pick file (drag and drop) ----
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    setError(null);

    const file = e.dataTransfer.files?.[0];
    if (!file) return;

    // Electron exposes the real filesystem path on File objects
    const filePath = (file as any).path as string;
    if (!filePath) {
      setError('Could not read file path.');
      return;
    }

    try {
      const parsed = await window.api.parseCsvPath(filePath);
      handleParsedCsv(parsed);
    } catch (err: any) {
      setError(err.message || 'Failed to read dropped file.');
    }
  };

  // ---- Step 2: Column mapping ----
  const canProceedToPreview = !!mapping.name && !!mapping.unitCost;

  const buildPreview = () => {
    if (!csv) return;

    // Build lookup indices for matching
    const byName = new Map<string, ExistingMaterial>();
    const byPartNumber = new Map<string, ExistingMaterial>();
    for (const mat of allMaterials) {
      byName.set(mat.name.toLowerCase().trim(), mat);
      if (mat.part_number) {
        byPartNumber.set(mat.part_number.toLowerCase().trim(), mat);
      }
    }

    const rows: PreviewRow[] = csv.rows.map((row, i) => {
      const csvName = (row[mapping.name] || '').trim();
      const rawCost = (row[mapping.unitCost] || '').replace(/[$,\s]/g, '');
      const csvUnitCost = rawCost ? parseFloat(rawCost) : null;
      const csvSupplier = mapping.supplier ? (row[mapping.supplier] || '').trim() : '';
      const csvPartNumber = mapping.partNumber ? (row[mapping.partNumber] || '').trim() : '';

      // Try matching: name first, then part number
      let matched: ExistingMaterial | null = null;
      let matchMethod: 'name' | 'part_number' | null = null;

      if (csvName) {
        const nameMatch = byName.get(csvName.toLowerCase());
        if (nameMatch) {
          matched = nameMatch;
          matchMethod = 'name';
        }
      }

      if (!matched && csvPartNumber) {
        const pnMatch = byPartNumber.get(csvPartNumber.toLowerCase());
        if (pnMatch) {
          matched = pnMatch;
          matchMethod = 'part_number';
        }
      }

      const priceChanged = matched !== null &&
        csvUnitCost !== null &&
        !isNaN(csvUnitCost) &&
        csvUnitCost !== matched.default_unit_cost;

      return {
        csvIndex: i,
        csvName,
        csvUnitCost,
        csvSupplier,
        csvPartNumber,
        matchedMaterial: matched,
        matchMethod,
        priceChanged,
        included: matched !== null && csvUnitCost !== null && !isNaN(csvUnitCost),
      };
    });

    setPreviewRows(rows);
    setStep('preview');
  };

  // ---- Step 3: Preview + Commit ----
  const toggleRow = (csvIndex: number) => {
    setPreviewRows((prev) =>
      prev.map((r) => (r.csvIndex === csvIndex ? { ...r, included: !r.included } : r))
    );
  };

  const toggleAll = (checked: boolean) => {
    setPreviewRows((prev) =>
      prev.map((r) => {
        if (r.matchedMaterial && r.csvUnitCost !== null && !isNaN(r.csvUnitCost)) {
          return { ...r, included: checked };
        }
        return r;
      })
    );
  };

  const stats = useMemo(() => {
    const matched = previewRows.filter((r) => r.matchedMaterial);
    const unmatched = previewRows.filter((r) => !r.matchedMaterial);
    const priceChanges = previewRows.filter((r) => r.priceChanged);
    const included = previewRows.filter((r) => r.included);
    return { matched: matched.length, unmatched: unmatched.length, priceChanges: priceChanges.length, included: included.length };
  }, [previewRows]);

  const handleCommit = async () => {
    const rowsToImport = previewRows
      .filter((r) => r.included && r.matchedMaterial && r.csvUnitCost !== null)
      .map((r) => ({
        materialId: r.matchedMaterial!.id,
        newPrice: r.csvUnitCost!,
        supplier: r.csvSupplier || undefined,
        partNumber: r.csvPartNumber || undefined,
      }));

    if (rowsToImport.length === 0) return;

    setImporting(true);
    setError(null);

    try {
      const source = csv?.fileName ? `CSV Import: ${csv.fileName}` : 'CSV Import';
      const res = await window.api.importPriceSheet(rowsToImport, source);
      if (res.error) {
        setError(res.error);
        setImporting(false);
        return;
      }
      setResult({
        updated: res.updated,
        skipped: res.skipped,
        unmatched: stats.unmatched,
      });
      setStep('done');
    } catch (err: any) {
      setError(err.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  // ---- Filtered rows for display ----
  const displayRows = showUnmatchedOnly
    ? previewRows.filter((r) => !r.matchedMaterial)
    : previewRows;

  const formatCurrency = (val: number) =>
    val.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: step === 'preview' ? 900 : 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <h3 style={{ marginBottom: 4 }}>
          {step === 'pick' && 'Import Prices from CSV'}
          {step === 'map' && 'Map Columns'}
          {step === 'preview' && 'Preview Import'}
          {step === 'done' && 'Import Complete'}
        </h3>

        {step !== 'done' && (
          <div className="text-muted" style={{ fontSize: 12, marginBottom: 16 }}>
            {step === 'pick' && 'Select a CSV file with material names and updated prices.'}
            {step === 'map' && `${csv?.rows.length} rows from ${csv?.fileName}. Map the CSV columns to the right fields.`}
            {step === 'preview' && 'Review changes before committing. Uncheck rows to skip them.'}
          </div>
        )}

        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid var(--danger)',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 16,
            fontSize: 13,
            color: '#fca5a5',
          }}>
            {error}
          </div>
        )}

        {/* ---- STEP: Pick file ---- */}
        {step === 'pick' && (
          <div style={{ padding: '20px 0' }}>
            <div style={{
              border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
              borderRadius: 12,
              padding: '40px 24px',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'border-color 0.15s, background 0.15s',
              background: dragging ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
            }}
              onClick={handlePickFile}
              onDragOver={(e) => { e.preventDefault(); }}
              onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setDragging(true); }}
              onDragLeave={() => { dragCounter.current--; if (dragCounter.current === 0) setDragging(false); }}
              onDrop={(e) => { dragCounter.current = 0; handleDrop(e); }}
              onMouseOver={(e) => { if (!dragging) e.currentTarget.style.borderColor = 'var(--accent)'; }}
              onMouseOut={(e) => { if (!dragging) e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              <div style={{ fontSize: 32, marginBottom: 12 }}>{dragging ? '📥' : '📄'}</div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>
                {dragging ? 'Drop CSV file here' : 'Drag a CSV file here, or click to browse'}
              </div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                Supports .csv and .tsv files from any supplier
              </div>
            </div>

            <div style={{ marginTop: 20, fontSize: 12, color: 'var(--text-muted)' }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Expected format:</div>
              <div style={{ fontFamily: 'monospace', background: 'var(--bg-tertiary)', borderRadius: 6, padding: '10px 14px', lineHeight: 1.8 }}>
                Name, Unit Cost, Supplier, Part #<br/>
                8" PVC SDR-35, 12.50, Ferguson, PVC0835<br/>
                4" DI Gate Valve, 285.00, HD Supply, GV-4DI
              </div>
              <div style={{ marginTop: 8 }}>Column order does not matter. You will map columns in the next step.</div>
            </div>
          </div>
        )}

        {/* ---- STEP: Map columns ---- */}
        {step === 'map' && csv && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Name mapping - required */}
              <div className="form-group">
                <label>
                  Material Name <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <select
                  className="form-control"
                  value={mapping.name}
                  onChange={(e) => setMapping({ ...mapping, name: e.target.value })}
                >
                  <option value="">-- select column --</option>
                  {availableHeaders('name').map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* Unit cost mapping - required */}
              <div className="form-group">
                <label>
                  Unit Cost <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <select
                  className="form-control"
                  value={mapping.unitCost}
                  onChange={(e) => setMapping({ ...mapping, unitCost: e.target.value })}
                >
                  <option value="">-- select column --</option>
                  {availableHeaders('unitCost').map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* Supplier mapping - optional */}
              <div className="form-group">
                <label>Supplier <span className="text-muted" style={{ fontWeight: 400 }}>(optional)</span></label>
                <select
                  className="form-control"
                  value={mapping.supplier}
                  onChange={(e) => setMapping({ ...mapping, supplier: e.target.value })}
                >
                  <option value="">-- skip --</option>
                  {availableHeaders('supplier').map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>

              {/* Part number mapping - optional */}
              <div className="form-group">
                <label>Part # <span className="text-muted" style={{ fontWeight: 400 }}>(optional)</span></label>
                <select
                  className="form-control"
                  value={mapping.partNumber}
                  onChange={(e) => setMapping({ ...mapping, partNumber: e.target.value })}
                >
                  <option value="">-- skip --</option>
                  {availableHeaders('partNumber').map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Sample preview */}
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
                First 3 rows with current mapping:
              </div>
              <table className="data-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="text-right">Unit Cost</th>
                    <th>Supplier</th>
                    <th>Part #</th>
                  </tr>
                </thead>
                <tbody>
                  {csv.rows.slice(0, 3).map((row, i) => (
                    <tr key={i}>
                      <td>{mapping.name ? row[mapping.name] || '--' : '--'}</td>
                      <td className="text-right">{mapping.unitCost ? row[mapping.unitCost] || '--' : '--'}</td>
                      <td>{mapping.supplier ? row[mapping.supplier] || '--' : '--'}</td>
                      <td>{mapping.partNumber ? row[mapping.partNumber] || '--' : '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-actions" style={{ marginTop: 24 }}>
              <button className="btn btn-secondary" onClick={() => setStep('pick')}>Back</button>
              <button
                className="btn btn-primary"
                onClick={buildPreview}
                disabled={!canProceedToPreview}
              >
                Preview Import
              </button>
            </div>
          </div>
        )}

        {/* ---- STEP: Preview ---- */}
        {step === 'preview' && (
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
            {/* Stats bar */}
            <div style={{
              display: 'flex',
              gap: 16,
              marginBottom: 16,
              fontSize: 13,
            }}>
              <div style={{
                padding: '6px 12px',
                borderRadius: 6,
                background: 'rgba(34, 197, 94, 0.12)',
                color: 'var(--success)',
              }}>
                {stats.matched} matched
              </div>
              <div style={{
                padding: '6px 12px',
                borderRadius: 6,
                background: 'rgba(245, 158, 11, 0.12)',
                color: 'var(--warning)',
              }}>
                {stats.unmatched} unrecognized
              </div>
              <div style={{
                padding: '6px 12px',
                borderRadius: 6,
                background: 'rgba(59, 130, 246, 0.12)',
                color: 'var(--accent)',
              }}>
                {stats.priceChanges} price change{stats.priceChanges !== 1 ? 's' : ''}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  id="showUnmatched"
                  checked={showUnmatchedOnly}
                  onChange={(e) => setShowUnmatchedOnly(e.target.checked)}
                />
                <label htmlFor="showUnmatched" style={{ fontSize: 12, cursor: 'pointer', color: 'var(--text-secondary)' }}>
                  Show unrecognized only
                </label>
              </div>
            </div>

            {/* Preview table */}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
              <table className="data-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        checked={stats.included === stats.matched && stats.matched > 0}
                        onChange={(e) => toggleAll(e.target.checked)}
                        title="Select all matched rows"
                      />
                    </th>
                    <th>CSV Name</th>
                    <th>Matched To</th>
                    <th>Match</th>
                    <th className="text-right">Current Price</th>
                    <th className="text-right">New Price</th>
                    <th className="text-right">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row) => {
                    const mat = row.matchedMaterial;
                    const diff = mat && row.csvUnitCost !== null
                      ? row.csvUnitCost - mat.default_unit_cost
                      : null;
                    const pctChange = mat && mat.default_unit_cost > 0 && diff !== null
                      ? (diff / mat.default_unit_cost) * 100
                      : null;

                    return (
                      <tr
                        key={row.csvIndex}
                        style={{
                          opacity: !mat ? 0.6 : 1,
                          background: !mat
                            ? 'rgba(245, 158, 11, 0.05)'
                            : row.included
                            ? undefined
                            : 'rgba(255,255,255,0.02)',
                        }}
                      >
                        <td>
                          {mat && row.csvUnitCost !== null && !isNaN(row.csvUnitCost) ? (
                            <input
                              type="checkbox"
                              checked={row.included}
                              onChange={() => toggleRow(row.csvIndex)}
                            />
                          ) : (
                            <span className="text-muted">--</span>
                          )}
                        </td>
                        <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.csvName || <span className="text-muted">(empty)</span>}
                        </td>
                        <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {mat ? mat.name : <span style={{ color: 'var(--warning)' }}>No match</span>}
                        </td>
                        <td>
                          {row.matchMethod === 'name' && (
                            <span style={{ fontSize: 11, color: 'var(--success)' }}>Name</span>
                          )}
                          {row.matchMethod === 'part_number' && (
                            <span style={{ fontSize: 11, color: 'var(--accent)' }}>Part #</span>
                          )}
                          {!row.matchMethod && (
                            <span style={{ fontSize: 11, color: 'var(--warning)' }}>--</span>
                          )}
                        </td>
                        <td className="text-right">
                          {mat ? formatCurrency(mat.default_unit_cost) : '--'}
                        </td>
                        <td className="text-right">
                          {row.csvUnitCost !== null && !isNaN(row.csvUnitCost)
                            ? formatCurrency(row.csvUnitCost)
                            : <span style={{ color: 'var(--warning)' }}>Invalid</span>
                          }
                        </td>
                        <td className="text-right">
                          {diff !== null && !isNaN(diff) ? (
                            <span style={{
                              color: diff > 0 ? 'var(--danger)' : diff < 0 ? 'var(--success)' : 'var(--text-muted)',
                              fontWeight: diff !== 0 ? 600 : 400,
                            }}>
                              {diff > 0 ? '+' : ''}{formatCurrency(diff)}
                              {pctChange !== null && (
                                <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 400 }}>
                                  ({diff > 0 ? '+' : ''}{pctChange.toFixed(1)}%)
                                </span>
                              )}
                            </span>
                          ) : '--'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="modal-actions" style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <button className="btn btn-secondary" onClick={() => setStep('map')}>Back</button>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginRight: 8, alignSelf: 'center' }}>
                {stats.included} price{stats.included !== 1 ? 's' : ''} will be updated
              </div>
              <button
                className="btn btn-primary"
                onClick={handleCommit}
                disabled={importing || stats.included === 0}
              >
                {importing ? 'Importing...' : `Update ${stats.included} Price${stats.included !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {/* ---- STEP: Done ---- */}
        {step === 'done' && result && (
          <div style={{ padding: '24px 0' }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>&#10003;</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Import Complete</div>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 12,
              marginBottom: 24,
            }}>
              <div style={{
                background: 'var(--bg-tertiary)',
                borderRadius: 8,
                padding: '16px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--success)' }}>{result.updated}</div>
                <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>Prices Updated</div>
              </div>
              <div style={{
                background: 'var(--bg-tertiary)',
                borderRadius: 8,
                padding: '16px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-muted)' }}>{result.skipped}</div>
                <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>Unchanged</div>
              </div>
              <div style={{
                background: 'var(--bg-tertiary)',
                borderRadius: 8,
                padding: '16px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--warning)' }}>{result.unmatched}</div>
                <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>Unrecognized</div>
              </div>
            </div>

            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
              Every price change has been logged to price history for audit.
            </div>

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => { onComplete(); onClose(); }}>
                Done
              </button>
            </div>
          </div>
        )}

        {/* Close button for pick/map steps */}
        {(step === 'pick' || step === 'map') && !error && (
          <div className="modal-actions" style={{ marginTop: step === 'pick' ? 0 : undefined }}>
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            {step === 'pick' && (
              <button className="btn btn-primary" onClick={handlePickFile}>Choose File</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
