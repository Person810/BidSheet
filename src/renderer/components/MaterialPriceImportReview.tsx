import React, { useMemo, useState } from 'react';
import type {
  MaterialPriceImportCreateDraft,
  MaterialPriceImportReviewRow,
} from '../../shared/materialPriceImport';

import {
  acknowledgeMaterialPriceImportUnitMismatch,
  filterMaterialPriceImportRows,
  materialPriceImportVisibleSelection,
  resetMaterialPriceImportRowDecision,
  setMaterialPriceImportRowSelection,
  setMaterialPriceImportShownSelection,
  setMaterialPriceImportFilter,
  setMaterialPriceImportManualTarget,
  setMaterialPriceImportRowAction,
  type MaterialPriceImportClassification,
  type MaterialPriceImportFilter,
  type MaterialPriceImportState,
} from './materialPriceImportState';
import {
  evaluateMaterialPriceImportConfirmationBlockers,
  isMaterialPriceImportConfirmationEnabled,
} from './materialPriceImportReviewValidation';

const CLASSIFICATION_LABELS: Record<
  MaterialPriceImportClassification,
  string
> = {
  matched: 'Matched',
  review: 'Possible match — review',
  unmatched: 'Unmatched',
  invalid: 'Invalid',
};

const FILTERS: Array<{ value: MaterialPriceImportFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'matched', label: 'Matched' },
  { value: 'review', label: 'Review' },
  { value: 'unmatched', label: 'Unmatched' },
  { value: 'invalid', label: 'Invalid' },
];

export interface MaterialPriceImportReviewProps {
  state: MaterialPriceImportState;
  drafts: MaterialPriceImportReviewRow[];
  categories: { id: number; name: string }[];
  importing: boolean;
  onStateChange: (state: MaterialPriceImportState) => void;
  onDraftChange: (
    id: number,
    patch: Partial<MaterialPriceImportCreateDraft>,
  ) => void;
  onBack: () => void;
  onConfirm: () => void;
}

function unitsDiffer(source: string | null, target: string | null): boolean {
  const left = (source ?? '').trim().toLocaleLowerCase();
  const right = (target ?? '').trim().toLocaleLowerCase();
  return left !== '' && right !== '' && left !== right;
}

export function MaterialPriceImportReview({
  state,
  drafts,
  categories,
  importing,
  onStateChange,
  onDraftChange,
  onBack,
  onConfirm,
}: MaterialPriceImportReviewProps) {
  const [selectionFeedback, setSelectionFeedback] = useState('');
  const [targetSearch, setTargetSearch] = useState('');
  const visibleRows = filterMaterialPriceImportRows(state);
  const counts = useMemo(() => {
    const result: Record<MaterialPriceImportClassification, number> = {
      matched: 0,
      review: 0,
      unmatched: 0,
      invalid: 0,
    };
    for (const row of state.rows) result[row.classification] += 1;
    return result;
  }, [state.rows]);
  const visibleSelection = materialPriceImportVisibleSelection(state);
  const categoryDefaults = useMemo(
    () => new Map(drafts.map((draft) => [
      draft.rowIndex,
      draft.createDraft.categoryId,
    ])),
    [drafts],
  );
  const blockers = evaluateMaterialPriceImportConfirmationBlockers({
    state,
    drafts,
    importing,
  });

  const changeFilter = (filter: MaterialPriceImportFilter) => {
    onStateChange(setMaterialPriceImportFilter(state, filter));
  };

  const createRow = (id: number) => {
    const draftCategoryId = drafts.find(
      (draft) => draft.rowIndex === id,
    )?.createDraft.categoryId ?? null;
    onStateChange(setMaterialPriceImportRowAction(state, id, {
      action: 'create',
      categoryId: draftCategoryId,
    }));
  };

  const selectShown = (selected: boolean) => {
    onStateChange(setMaterialPriceImportShownSelection(
      state,
      selected,
    ));
    setSelectionFeedback(selected
      ? 'All eligible shown rows selected for import.'
      : 'All shown rows excluded from import.');
  };

  const showFirstBlocker = (rowId: number) => {
    onStateChange(setMaterialPriceImportFilter(state, 'all'));
    window.setTimeout(() => {
      document.getElementById(`material-price-import-row-${rowId}`)?.focus();
      document.getElementById(`material-price-import-row-${rowId}`)?.scrollIntoView({
        block: 'center',
      });
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <div
        aria-live="polite"
        style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}
      >
        {FILTERS.slice(1).map(({ value, label }) => (
          <span key={value} className="text-muted" style={{ fontSize: 12 }}>
            {label}: {counts[value as MaterialPriceImportClassification]}
          </span>
        ))}
        <label style={{ marginLeft: 'auto', fontSize: 12 }}>
          <span className="text-muted" style={{ marginRight: 6 }}>Show</span>
          <select
            aria-label="Filter import rows"
            className="form-control"
            style={{ display: 'inline-block', width: 130 }}
            value={state.filter}
            onChange={(event) => changeFilter(
              event.target.value as MaterialPriceImportFilter,
            )}
          >
            {FILTERS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      <div
        className="card"
        style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: 10, marginBottom: 12 }}
      >
        <button className="btn btn-sm btn-secondary" type="button" onClick={() => selectShown(true)}>
          Select all shown
        </button>
        <button className="btn btn-sm btn-secondary" type="button" onClick={() => selectShown(false)}>
          Deselect all shown
        </button>
        <span className="text-muted">
          {visibleSelection.selected} of {visibleSelection.shown} shown rows selected for import.
        </span>
        <span className="text-muted">
          Selected unmatched rows will be created as new materials. Deselected rows will not be imported.
        </span>
        {selectionFeedback && <span aria-live="polite">{selectionFeedback}</span>}
      </div>

      <label style={{ marginBottom: 10 }}>
        Search existing materials
        <input
          className="form-control"
          value={targetSearch}
          placeholder="Filter target choices by name"
          onChange={(event) => setTargetSearch(event.target.value)}
        />
      </label>

      <div style={{ overflowY: 'auto', minHeight: 0, flex: 1 }}>
        <table className="data-table" style={{ fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ width: 36 }}>Import</th>
              <th>Import row</th>
              <th style={{ width: 90 }}>Status</th>
              <th style={{ width: 300 }}>Decision</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const draft = drafts.find(({ rowIndex }) => rowIndex === row.id);
              const currentMaterial = state.materials.find(
                ({ id }) => id === row.targetMaterialId,
              );
              const searchKey = targetSearch.trim().toLocaleLowerCase();
              const candidateMaterials = state.materials.filter((material) => (
                material.id === row.targetMaterialId
                || !searchKey
                || material.name.toLocaleLowerCase().includes(searchKey)
              ));
              const mismatch = row.action === 'update'
                && unitsDiffer(row.sourceUnit, row.targetUnit);
              return (
                <tr
                  key={row.id}
                  id={`material-price-import-row-${row.id}`}
                  tabIndex={-1}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Import ${row.description}`}
                      checked={row.selected}
                      disabled={row.classification === 'invalid'}
                      onChange={(event) => onStateChange(
                        setMaterialPriceImportRowSelection(
                          state,
                          row.id,
                          event.target.checked,
                          categoryDefaults.get(row.id) ?? null,
                        ),
                      )}
                    />
                  </td>
                  <td>
                    <div>{row.description || '(no description)'}</div>
                    <div className="text-muted" style={{ fontSize: 11 }}>
                      {row.sourceUnit || 'no unit'}
                      {' · '}
                      {row.price == null ? 'invalid price' : row.price}
                    </div>
                    {row.action === 'update' && (
                      <strong>Proposed action: Update</strong>
                    )}
                    {row.selected && row.action === 'create' && (
                      <strong>Proposed action: Create New Material</strong>
                    )}
                    {!row.selected && row.classification !== 'invalid' && (
                      <strong>Excluded from import</strong>
                    )}
                    <div className="text-muted" style={{ fontSize: 11 }}>
                      Current price: {currentMaterial?.defaultUnitCost ?? '—'}
                      {' · '}
                      Imported price: {row.price ?? 'invalid'}
                      {' · '}
                      Match reason: {
                        draft?.matchReasons.join(', ')
                        || (row.action === 'update' ? 'manual selection' : '—')
                      }
                    </div>
                  </td>
                  <td>
                    <span>{CLASSIFICATION_LABELS[row.classification]}</span>
                  </td>
                  <td>
                    {row.classification === 'invalid' ? (
                      <span className="text-muted">Excluded — invalid source row.</span>
                    ) : (
                      <>
                        <select
                          aria-label={`Choose material for ${row.description}`}
                          className="form-control"
                          style={{ width: '100%', marginBottom: 6 }}
                          value={row.action === 'update'
                            ? String(row.targetMaterialId ?? '')
                            : ''}
                          onChange={(event) => {
                            if (!event.target.value) {
                              onStateChange(
                                resetMaterialPriceImportRowDecision(state, row.id),
                              );
                              return;
                            }
                            onStateChange(setMaterialPriceImportManualTarget(
                              state,
                              row.id,
                              Number(event.target.value),
                            ));
                          }}
                        >
                          <option value="">Choose existing material…</option>
                          {candidateMaterials.map((material) => (
                            <option key={material.id} value={material.id}>
                              {material.name} ({material.unit || 'no unit'})
                            </option>
                          ))}
                        </select>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            className="btn btn-sm btn-secondary"
                            type="button"
                            onClick={() => createRow(row.id)}
                          >
                            Create new material
                          </button>
                          <button
                            className="btn btn-sm btn-secondary"
                            type="button"
                            onClick={() => onStateChange(
                              setMaterialPriceImportRowSelection(
                                state,
                                row.id,
                                false,
                                categoryDefaults.get(row.id) ?? null,
                              ),
                            )}
                          >
                            Exclude from import
                          </button>
                          {row.action !== 'unresolved' && (
                            <button
                              className="btn btn-sm btn-secondary"
                              type="button"
                              onClick={() => onStateChange(
                                resetMaterialPriceImportRowDecision(state, row.id),
                              )}
                            >
                              Reset
                            </button>
                          )}
                        </div>
                        {row.action === 'create' && draft && (
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                            gap: 6,
                            marginTop: 8,
                          }}>
                            <label>
                              Name for new material
                              <input
                                className="form-control"
                                value={draft.createDraft.name}
                                onChange={(event) => onDraftChange(row.id, {
                                  name: event.target.value,
                                })}
                              />
                            </label>
                            <label>
                              Unit for new material
                              <input
                                className="form-control"
                                value={draft.createDraft.unit}
                                onChange={(event) => onDraftChange(row.id, {
                                  unit: event.target.value,
                                })}
                              />
                            </label>
                            <label>
                              Supplier for new material
                              <input
                                className="form-control"
                                value={draft.createDraft.supplier ?? ''}
                                onChange={(event) => onDraftChange(row.id, {
                                  supplier: event.target.value || null,
                                })}
                              />
                            </label>
                            <label>
                              Part number for new material
                              <input
                                className="form-control"
                                value={draft.createDraft.partNumber ?? ''}
                                onChange={(event) => onDraftChange(row.id, {
                                  partNumber: event.target.value || null,
                                })}
                              />
                            </label>
                            <label>
                              Description for new material
                              <input
                                className="form-control"
                                value={draft.createDraft.description ?? ''}
                                onChange={(event) => onDraftChange(row.id, {
                                  description: event.target.value || null,
                                })}
                              />
                            </label>
                            <label>
                              Category for new material
                              <select
                                className="form-control"
                                value={row.categoryId ?? ''}
                                onChange={(event) => onStateChange(
                                  setMaterialPriceImportRowAction(state, row.id, {
                                    action: 'create',
                                    categoryId: event.target.value
                                      ? Number(event.target.value)
                                      : null,
                                  }),
                                )}
                              >
                                <option value="">
                                  Uncategorised (create or reuse)
                                </option>
                                {categories.map((category) => (
                                  <option key={category.id} value={category.id}>
                                    {category.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <span className="text-muted">
                              Imported unit cost: {row.price}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                    {mismatch && (
                      <label style={{ display: 'block', marginTop: 6, color: 'var(--warning)' }}>
                        <input
                          type="checkbox"
                          checked={row.unitMismatchAcknowledged}
                          onChange={() => onStateChange(
                            acknowledgeMaterialPriceImportUnitMismatch(state, row.id),
                          )}
                        />{' '}
                        Unit mismatch: quote {row.sourceUnit} and material {row.targetUnit}. Confirm without conversion.
                      </label>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="modal-actions" style={{ marginTop: 14 }}>
        {blockers.length > 0 && (
          <div role="alert" aria-live="assertive" style={{ color: 'var(--warning)', marginRight: 'auto' }}>
            {blockers.map((blocker) => (
              <div key={blocker.type}>
                <span>{blocker.message}</span>
                {blocker.firstRowId != null && (
                  <button
                    className="btn btn-sm btn-secondary"
                    type="button"
                    onClick={() => showFirstBlocker(blocker.firstRowId as number)}
                  >
                    Show first blocking row
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <button
          className="btn btn-secondary"
          type="button"
          disabled={importing}
          onClick={onBack}
        >
          Back
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!isMaterialPriceImportConfirmationEnabled(blockers)}
          onClick={onConfirm}
        >
          {importing ? 'Importing…' : 'Confirm & import'}
        </button>
      </div>
    </div>
  );
}
