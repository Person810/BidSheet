import React, { useRef, useState } from 'react';
import type { CsvParseResult } from '../../shared/types/ipc';

/**
 * Shared CSV-import primitives used by both the catalog price-sheet import
 * (CsvImportModal) and the per-job quote import (JobPriceImportModal): the
 * drag-and-drop file picker, header → field auto-mapping, the labeled column
 * selects, and price parsing. One source of truth so the two flows can't
 * drift apart.
 */

/**
 * Pick a CSV header for each field by trying its known aliases in order.
 * `aliases` is field → lowercase header candidates; the returned mapping has
 * one entry per field (empty string when nothing matched). A header is only
 * claimed once, so earlier fields win ties.
 */
export function autoDetectMapping(
  headers: string[],
  aliases: Record<string, string[]>,
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const field of Object.keys(aliases)) mapping[field] = '';

  const lower = headers.map((h) => h.toLowerCase().trim());
  const claimed = new Set<string>();
  for (const field of Object.keys(aliases)) {
    for (const alias of aliases[field]) {
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

/** Headers still selectable for `field`: unclaimed by others, plus its own. */
export function availableHeaders(
  headers: string[],
  mapping: Record<string, string>,
  field: string,
): string[] {
  const used = new Set(
    Object.entries(mapping).filter(([k, v]) => v && k !== field).map(([, v]) => v),
  );
  return headers.filter((h) => !used.has(h));
}

/** Parse a money/number cell ("$1,250.00" → 1250). null when blank/invalid. */
export function parseCsvPrice(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** A labeled select that maps one field to a CSV column. */
export function ColumnSelect({ label, required, value, options, onChange }: {
  label: string;
  required?: boolean;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="form-group">
      <label>{label} {required
        ? <span style={{ color: 'var(--danger)' }}>*</span>
        : <span className="text-muted" style={{ fontWeight: 400 }}>(optional)</span>}</label>
      <select className="form-control" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{required ? '-- select column --' : '-- skip --'}</option>
        {options.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
    </div>
  );
}

/**
 * Drag-and-drop / click-to-browse CSV picker. Validates the parse result
 * (surfacing parse errors and empty files via `onError`) and only calls
 * `onParsed` with a usable, non-empty CSV.
 */
export function CsvDropZone({ onParsed, onError, hint }: {
  onParsed: (parsed: CsvParseResult) => void;
  onError: (msg: string) => void;
  hint?: React.ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);

  const accept = (parsed: CsvParseResult | null) => {
    if (!parsed) return;
    if (parsed.error) { onError(parsed.error); return; }
    if (parsed.rows.length === 0) { onError('That file has no data rows.'); return; }
    onParsed(parsed);
  };

  const browse = async () => {
    try { accept(await window.api.openCsvFile()); }
    catch (err: any) { onError(err.message || 'Failed to open file.'); }
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current = 0; setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    let filePath = '';
    try { filePath = window.api.getDroppedFilePath(file); } catch { filePath = ''; }
    if (!filePath) { onError('Could not read the dropped file path.'); return; }
    try { accept(await window.api.parseCsvPath(filePath)); }
    catch (err: any) { onError(err.message || 'Failed to read dropped file.'); }
  };

  return (
    <>
      <div style={{
        border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 12, padding: '40px 24px', textAlign: 'center', cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
        background: dragging ? 'rgba(59,130,246,0.08)' : 'transparent' }}
        onClick={browse}
        onDragOver={(e) => e.preventDefault()}
        onDragEnter={(e) => { e.preventDefault(); dragCounter.current++; setDragging(true); }}
        onDragLeave={() => { dragCounter.current--; if (dragCounter.current === 0) setDragging(false); }}
        onDrop={onDrop}
        onMouseOver={(e) => { if (!dragging) e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onMouseOut={(e) => { if (!dragging) e.currentTarget.style.borderColor = 'var(--border)'; }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>{dragging ? '\u{1F4E5}' : '\u{1F4C4}'}</div>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>
          {dragging ? 'Drop the file here' : 'Drag a CSV file here, or click to browse'}
        </div>
        <div className="text-muted" style={{ fontSize: 12 }}>Supports .csv and .tsv files</div>
      </div>
      {hint}
    </>
  );
}
