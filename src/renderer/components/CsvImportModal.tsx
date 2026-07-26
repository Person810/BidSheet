import React, { useEffect, useState } from 'react';
import type {
  MaterialCategoryRow,
  MaterialPriceImportResult,
  MaterialRow,
} from '../../shared/types/ipc';
import {
  buildMaterialPriceImportReview,
  type MaterialPriceImportReviewRow,
  type MaterialPriceImportSourceRow,
} from '../../shared/materialPriceImport';
import {
  createMaterialPriceImportState,
  type MaterialPriceImportState,
} from './materialPriceImportState';
import { MaterialPriceImportReview } from './MaterialPriceImportReview';
import { buildMaterialPriceImportRequest } from './materialPriceImportCommit';
import {
  autoDetectMapping,
  availableHeaders as availableHeadersFor,
  ColumnSelect,
  CsvDropZone,
} from './csvImport';
import { dismissOnEscOnly } from './modalDismiss';

interface CsvRow {
  [key: string]: string;
}

interface ParsedCsv {
  headers: string[];
  rows: CsvRow[];
  fileName: string;
}

type ImportStep = 'pick' | 'map' | 'review' | 'done';

const HEADER_ALIASES: Record<string, string[]> = {
  name: [
    'name', 'material', 'item', 'product', 'material name', 'item name',
    'product name',
  ],
  unitCost: [
    'unit cost', 'unit price', 'price', 'cost', 'rate', 'unit_cost',
    'unit_price', 'unitcost', 'unitprice', 'amount',
  ],
  unit: ['unit', 'uom', 'unit of measure', 'units'],
  supplier: [
    'supplier', 'vendor', 'source', 'manufacturer', 'mfg', 'distributor',
  ],
  partNumber: [
    'part number', 'part #', 'part#', 'part_number', 'partnumber', 'sku',
    'item #', 'item#', 'catalog #', 'catalog#', 'model', 'item number',
  ],
  description: ['description', 'details', 'product description', 'notes'],
  category: ['category', 'material category', 'group', 'type'],
};

const EMPTY_MAPPING: Record<string, string> = {
  name: '',
  unitCost: '',
  unit: '',
  supplier: '',
  partNumber: '',
  description: '',
  category: '',
};

function field(row: CsvRow, mapping: Record<string, string>, key: string): string {
  return mapping[key] ? row[mapping[key]] ?? '' : '';
}

function classification(
  value: MaterialPriceImportReviewRow['classification'],
): 'matched' | 'review' | 'unmatched' | 'invalid' {
  return value === 'ambiguous' ? 'review' : value;
}

function MappingFields({
  csv,
  mapping,
  onChange,
}: {
  csv: ParsedCsv;
  mapping: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const fields = [
    ['name', 'Material Name', true],
    ['unitCost', 'Unit Cost', true],
    ['unit', 'Unit', false],
    ['supplier', 'Supplier', false],
    ['partNumber', 'Part #', false],
    ['description', 'Description', false],
    ['category', 'Category', false],
  ] as const;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: 16,
    }}>
      {fields.map(([key, label, required]) => (
        <ColumnSelect
          key={key}
          label={label}
          required={required}
          value={mapping[key]}
          options={availableHeadersFor(csv.headers, mapping, key)}
          onChange={(value) => onChange({ ...mapping, [key]: value })}
        />
      ))}
    </div>
  );
}

export function CsvImportModal({
  onComplete,
  onClose,
}: {
  onComplete: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [step, setStep] = useState<ImportStep>('pick');
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [categories, setCategories] = useState<MaterialCategoryRow[]>([]);
  const [mapping, setMapping] = useState(EMPTY_MAPPING);
  const [reviewRows, setReviewRows] = useState<MaterialPriceImportReviewRow[]>([]);
  const [reviewState, setReviewState] = useState<MaterialPriceImportState | null>(null);
  const [result, setResult] = useState<MaterialPriceImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [postCommitWarning, setPostCommitWarning] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    Promise.all([
      window.api.getMaterials(),
      window.api.getMaterialCategories(),
    ]).then(([loadedMaterials, loadedCategories]) => {
      setMaterials(loadedMaterials);
      setCategories(loadedCategories);
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not load the catalogue.');
    });
  }, []);

  const onFileParsed = (parsed: { headers: string[] }) => {
    const loaded = parsed as ParsedCsv;
    setError(null);
    setCsv(loaded);
    setMapping({ ...EMPTY_MAPPING, ...autoDetectMapping(loaded.headers, HEADER_ALIASES) });
    setStep('map');
  };

  const buildReview = () => {
    if (!csv) return;
    try {
      const sourceRows: MaterialPriceImportSourceRow[] = csv.rows.map((row, index) => ({
        rowIndex: index,
        nameText: field(row, mapping, 'name'),
        unitCostText: field(row, mapping, 'unitCost'),
        unitText: field(row, mapping, 'unit'),
        supplierText: field(row, mapping, 'supplier'),
        partNumberText: field(row, mapping, 'partNumber'),
        descriptionText: field(row, mapping, 'description'),
        categoryText: field(row, mapping, 'category'),
      }));
      const categoryNames = new Map(categories.map(({ id, name }) => [id, name]));
      const built = buildMaterialPriceImportReview(
        sourceRows,
        materials.map((material) => ({
          id: material.id,
          name: material.name,
          categoryId: material.category_id,
          categoryName: categoryNames.get(material.category_id) ?? '',
          unit: material.unit,
          defaultUnitCost: material.default_unit_cost,
          supplier: material.supplier,
          partNumber: material.part_number,
          description: material.description,
        })),
        categories,
      );
      setReviewRows(built.rows);
      setReviewState(createMaterialPriceImportState(
        built.rows.map((row) => ({
          id: row.rowIndex,
          description: row.createDraft.name || `Row ${row.rowIndex + 1}`,
          price: row.unitCost,
          unit: row.importedUnit || row.createDraft.unit,
          classification: classification(row.classification),
          proposedMaterialId:
            row.classification === 'matched' ? row.targetMaterialId : null,
          defaultCreateCategoryId: row.createDraft.categoryId,
        })),
        materials.map((material) => ({
          id: material.id,
          name: material.name,
          unit: material.unit,
          categoryId: material.category_id,
          defaultUnitCost: material.default_unit_cost,
        })),
      ));
      setError(null);
      setStep('review');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not review this file.');
    }
  };

  const handleCommit = async () => {
    if (!csv || !reviewState) return;
    setImporting(true);
    setError(null);
    setPostCommitWarning(null);
    try {
      const request = buildMaterialPriceImportRequest(
        csv.fileName || 'CSV Import',
        reviewState,
        reviewRows,
      );
      const committed = await window.api.importPriceSheet(request);
      if (committed.error) throw new Error(committed.error);
      setResult(committed);
      setStep('done');
      try {
        await onComplete();
      } catch {
        setPostCommitWarning(
          'Import completed successfully, but the catalogue could not refresh. '
          + 'Reopen Materials to see the imported records.',
        );
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  const updateDraft = (
    id: number,
    patch: Partial<MaterialPriceImportReviewRow['createDraft']>,
  ) => {
    setReviewRows((current) => current.map((row) => (
      row.rowIndex === id
        ? { ...row, createDraft: { ...row.createDraft, ...patch } }
        : row
    )));
    setReviewState((current) => current ? {
      ...current,
      rows: current.rows.map((row) => row.id === id ? {
        ...row,
        description: patch.name ?? row.description,
        unit: patch.unit ?? row.unit,
        sourceUnit: patch.unit ?? row.sourceUnit,
      } : row),
    } : current);
  };

  const requestClose = () => {
    if (!importing) onClose();
  };

  const title = step === 'pick'
    ? 'Import Prices from CSV'
    : step === 'map'
      ? 'Map Columns'
      : step === 'review'
        ? 'Review Import'
        : 'Import Complete';

  return (
    <div className="modal-overlay" onClick={dismissOnEscOnly(requestClose)}>
      <div
        className="modal"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: step === 'review' ? 1060 : 620,
          maxHeight: '88vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <h3 style={{ marginBottom: 12 }}>{title}</h3>
        {error && (
          <div role="alert" style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid var(--danger)',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 16,
          }}>
            {error}
          </div>
        )}
        {postCommitWarning && (
          <div role="alert" style={{
            background: 'rgba(245, 158, 11, 0.15)',
            border: '1px solid var(--warning)',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 16,
          }}>
            {postCommitWarning}
          </div>
        )}

        {step === 'pick' && (
          <>
            <div style={{
              background: 'var(--bg-tertiary)',
              borderRadius: 8,
              padding: 14,
              marginBottom: 16,
            }}>
              <p style={{ marginTop: 0 }}>
                A header row is required. Required fields: <strong>Material Name</strong>
                {' '}and <strong>Unit Cost</strong>.
              </p>
              <p>
                Optional fields: Unit, Supplier, Part Number, Description and Category.
                Header names may vary; columns are mapped on the next step.
              </p>
              <p>
                CSV, TSV and TXT files may use comma or tab separation, with up to
                {' '}10,000 data rows. A missing Unit defaults to EA; a missing or
                unknown Category defaults to Uncategorised.
              </p>
              <details>
                <summary style={{ cursor: 'pointer' }}>Show a valid example</summary>
                <pre style={{
                  marginBottom: 0,
                  overflowX: 'auto',
                  overflowWrap: 'anywhere',
                  whiteSpace: 'pre-wrap',
                }}>
                  {`Material Name,Unit Cost,Unit,Supplier,Part Number,Description,Category\nCisco Catalyst 9600 Chassis,16488.18,EA,ITNest,C9606R,"Core network chassis",IT Equipment`}
                </pre>
              </details>
            </div>
            <CsvDropZone
              onParsed={onFileParsed}
              onError={setError}
              hint={<p className="text-muted">CSV, TSV or text; up to 10,000 rows.</p>}
            />
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {step === 'map' && csv && (
          <>
            <p className="text-muted">
              {csv.rows.length} rows from {csv.fileName}. Map the available fields.
              New materials use EA and Uncategorised when those fields are absent.
            </p>
            <MappingFields csv={csv} mapping={mapping} onChange={setMapping} />
            <div className="modal-actions" style={{ marginTop: 24 }}>
              <button className="btn btn-secondary" onClick={() => setStep('pick')}>Back</button>
              <button
                className="btn btn-primary"
                onClick={buildReview}
                disabled={!mapping.name || !mapping.unitCost}
              >
                Review all rows
              </button>
            </div>
          </>
        )}

        {step === 'review' && reviewState && (
          <MaterialPriceImportReview
            state={reviewState}
            drafts={reviewRows}
            categories={categories}
            importing={importing}
            onStateChange={setReviewState}
            onDraftChange={updateDraft}
            onBack={() => setStep('map')}
            onConfirm={handleCommit}
          />
        )}

        {step === 'done' && result && (
          <div aria-live="polite">
            <p>Import completed atomically. Every changed price has provenance.</p>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 12,
            }}>
              {[
                ['Updated', result.updated],
                ['Created', result.created],
                ['Unchanged', result.unchanged],
                ['Ignored', result.ignored],
                ['Invalid', result.invalid],
                ['Total', result.total],
              ].map(([label, value]) => (
                <div key={label} style={{
                  background: 'var(--bg-tertiary)',
                  borderRadius: 8,
                  padding: 14,
                  textAlign: 'center',
                }}>
                  <strong style={{ fontSize: 22 }}>{value}</strong>
                  <div className="text-muted">{label}</div>
                </div>
              ))}
            </div>
            <div className="modal-actions" style={{ marginTop: 20 }}>
              <button
                className="btn btn-primary"
                onClick={() => onClose()}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
