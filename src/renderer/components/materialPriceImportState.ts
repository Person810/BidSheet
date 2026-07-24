export type MaterialPriceImportClassification =
  | 'matched'
  | 'review'
  | 'unmatched'
  | 'invalid';

export type MaterialPriceImportFilter =
  | 'all'
  | MaterialPriceImportClassification;

export type MaterialPriceImportAction =
  | 'unresolved'
  | 'update'
  | 'create'
  | 'ignore';

export interface MaterialPriceImportCandidate {
  id: number;
  name: string;
  unit: string | null;
  categoryId: number;
  defaultUnitCost?: number;
}

export interface MaterialPriceImportSourceRow {
  id: number;
  description: string;
  price: number | null;
  unit: string | null;
  classification: MaterialPriceImportClassification;
  proposedMaterialId: number | null;
  defaultCreateCategoryId?: number | null;
}

export interface MaterialPriceImportRow extends MaterialPriceImportSourceRow {
  action: MaterialPriceImportAction;
  targetMaterialId: number | null;
  categoryId: number | null;
  selected: boolean;
  sourceUnit: string | null;
  targetUnit: string | null;
  unitMismatchAcknowledged: boolean;
}

export interface MaterialPriceImportState {
  filter: MaterialPriceImportFilter;
  rows: MaterialPriceImportRow[];
  materials: MaterialPriceImportCandidate[];
}

export type MaterialPriceImportRowDecision =
  | { action: 'create'; categoryId: number | null }
  | { action: 'ignore' };

export type MaterialPriceImportBulkDecision = MaterialPriceImportRowDecision;

export interface MaterialPriceImportVisibleSelection {
  selected: number;
  shown: number;
}

export interface MaterialPriceImportBulkActionResult {
  state: MaterialPriceImportState;
  affectedRowIds: number[];
  ineligibleRowIds: number[];
  affectedCount: number;
  ineligibleCount: number;
}

function hasUnitMismatch(source: string | null, target: string | null): boolean {
  const sourceUnit = materialPriceComparisonKey(source);
  const targetUnit = materialPriceComparisonKey(target);
  return sourceUnit !== '' && targetUnit !== '' && sourceUnit !== targetUnit;
}

function initialRow(
  source: MaterialPriceImportSourceRow,
  materials: readonly MaterialPriceImportCandidate[],
): MaterialPriceImportRow {
  const proposed = materials.find(
    (material) => material.id === source.proposedMaterialId,
  );
  const isMatched = source.classification === 'matched' && proposed !== undefined;
  const isInvalid = source.classification === 'invalid';
  const targetUnit = isMatched ? proposed.unit : null;

  return {
    ...source,
    action: isMatched ? 'update' : isInvalid ? 'ignore' : 'unresolved',
    targetMaterialId: isMatched ? proposed.id : null,
    categoryId: null,
    selected: isMatched,
    sourceUnit: source.unit,
    targetUnit,
    unitMismatchAcknowledged: !hasUnitMismatch(source.unit, targetUnit),
  };
}

export function createMaterialPriceImportState(
  rows: readonly MaterialPriceImportSourceRow[],
  materials: readonly MaterialPriceImportCandidate[],
): MaterialPriceImportState {
  return {
    filter: 'all',
    rows: rows.map((row) => initialRow(row, materials)),
    materials: materials.map((material) => ({ ...material })),
  };
}

export function setMaterialPriceImportFilter(
  state: MaterialPriceImportState,
  filter: MaterialPriceImportFilter,
): MaterialPriceImportState {
  return { ...state, filter };
}

export function filterMaterialPriceImportRows(
  state: MaterialPriceImportState,
): MaterialPriceImportRow[] {
  return state.filter === 'all'
    ? [...state.rows]
    : state.rows.filter((row) => row.classification === state.filter);
}

function isShown(
  state: MaterialPriceImportState,
  row: MaterialPriceImportRow,
): boolean {
  return state.filter === 'all' || row.classification === state.filter;
}

export function materialPriceImportVisibleSelection(
  state: MaterialPriceImportState,
): MaterialPriceImportVisibleSelection {
  const shownRows = state.rows.filter((row) => (
    isShown(state, row) && row.classification !== 'invalid'
  ));
  return {
    selected: shownRows.filter((row) => row.selected).length,
    shown: shownRows.length,
  };
}

export function setMaterialPriceImportShownSelection(
  state: MaterialPriceImportState,
  selected: boolean,
): MaterialPriceImportState {
  return {
    ...state,
    rows: state.rows.map((row) => (
      isShown(state, row) && row.classification !== 'invalid'
        ? applyMaterialPriceImportSelection(row, selected)
        : row
    )),
  };
}

function updateRow(
  state: MaterialPriceImportState,
  id: number,
  update: (row: MaterialPriceImportRow) => MaterialPriceImportRow,
): MaterialPriceImportState {
  return {
    ...state,
    rows: state.rows.map((row) => (row.id === id ? update(row) : row)),
  };
}

export function toggleMaterialPriceImportRow(
  state: MaterialPriceImportState,
  id: number,
): MaterialPriceImportState {
  const row = state.rows.find((candidate) => candidate.id === id);
  return row
    ? setMaterialPriceImportRowSelection(state, id, !row.selected)
    : state;
}

function applyMaterialPriceImportSelection(
  row: MaterialPriceImportRow,
  selected: boolean,
  defaultCategoryId = row.defaultCreateCategoryId ?? null,
): MaterialPriceImportRow {
  if (row.classification === 'invalid') return row;
  if (
    selected
    && row.classification === 'unmatched'
    && row.action === 'unresolved'
  ) {
    return {
      ...row,
      selected: true,
      action: 'create',
      categoryId: defaultCategoryId,
      targetMaterialId: null,
      targetUnit: null,
      unitMismatchAcknowledged: true,
    };
  }
  return { ...row, selected };
}

export function setMaterialPriceImportRowSelection(
  state: MaterialPriceImportState,
  id: number,
  selected: boolean,
  defaultCategoryId?: number | null,
): MaterialPriceImportState {
  return updateRow(state, id, (row) => applyMaterialPriceImportSelection(
    row,
    selected,
    defaultCategoryId ?? row.defaultCreateCategoryId ?? null,
  ));
}

function requireCategory(categoryId: number | null): number {
  if (!Number.isSafeInteger(categoryId) || (categoryId ?? 0) <= 0) {
    throw new Error('Choose a category before creating imported materials.');
  }
  return categoryId as number;
}

function assertResolvable(row: MaterialPriceImportRow): void {
  if (row.classification === 'invalid') {
    throw new Error('Invalid rows can only be ignored.');
  }
}

export function setMaterialPriceImportRowAction(
  state: MaterialPriceImportState,
  id: number,
  decision: MaterialPriceImportRowDecision,
): MaterialPriceImportState {
  return updateRow(state, id, (row) => {
    if (decision.action === 'create') {
      assertResolvable(row);
      return {
        ...row,
        action: 'create',
        // Null is the explicit lazy Uncategorised fallback. Bulk creation still
        // requires a chosen positive category so its effect stays deliberate.
        categoryId: decision.categoryId === null
          ? null
          : requireCategory(decision.categoryId),
        targetMaterialId: null,
        targetUnit: null,
        unitMismatchAcknowledged: true,
        selected: true,
      };
    }
    return {
      ...row,
      action: 'ignore',
      categoryId: null,
      targetMaterialId: null,
      targetUnit: null,
      unitMismatchAcknowledged: true,
      selected: row.classification === 'invalid' ? false : true,
    };
  });
}

export function setMaterialPriceImportManualTarget(
  state: MaterialPriceImportState,
  id: number,
  targetMaterialId: number,
): MaterialPriceImportState {
  const target = state.materials.find(
    (material) => material.id === targetMaterialId,
  );
  if (!target) throw new Error('Choose an existing material.');

  return updateRow(state, id, (row) => {
    assertResolvable(row);
    return {
      ...row,
      action: 'update',
      targetMaterialId: target.id,
      categoryId: null,
      selected: true,
      sourceUnit: row.unit,
      targetUnit: target.unit,
      unitMismatchAcknowledged: !hasUnitMismatch(row.unit, target.unit),
    };
  });
}

export function acknowledgeMaterialPriceImportUnitMismatch(
  state: MaterialPriceImportState,
  id: number,
): MaterialPriceImportState {
  return updateRow(state, id, (row) => ({
    ...row,
    unitMismatchAcknowledged: true,
  }));
}

export function applyMaterialPriceImportBulkAction(
  state: MaterialPriceImportState,
  decision: MaterialPriceImportBulkDecision,
): MaterialPriceImportState {
  const categoryId = decision.action === 'create'
    ? requireCategory(decision.categoryId)
    : null;

  return {
    ...state,
    rows: state.rows.map((row) => {
      if (!row.selected) return row;
      if (decision.action === 'create') {
        if (row.classification !== 'unmatched') return row;
        return {
          ...row,
          action: 'create',
          categoryId,
          targetMaterialId: null,
          targetUnit: null,
          unitMismatchAcknowledged: true,
        };
      }
      if (row.action === 'ignore' || row.classification === 'matched') return row;
      return {
        ...row,
        action: 'ignore',
        categoryId: null,
        targetMaterialId: null,
        targetUnit: null,
        unitMismatchAcknowledged: true,
      };
    }),
  };
}

function isEligibleForBulkDecision(
  row: MaterialPriceImportRow,
  decision: MaterialPriceImportBulkDecision,
): boolean {
  if (row.classification === 'invalid') return false;
  if (decision.action === 'create') {
    return row.classification === 'unmatched' && row.action === 'unresolved';
  }
  return row.action !== 'ignore';
}

function applyEligibleBulkDecision(
  row: MaterialPriceImportRow,
  decision: MaterialPriceImportBulkDecision,
  categoryId: number | null,
): MaterialPriceImportRow {
  if (decision.action === 'create') {
    return {
      ...row,
      action: 'create',
      categoryId,
      targetMaterialId: null,
      targetUnit: null,
      unitMismatchAcknowledged: true,
    };
  }
  return {
    ...row,
    action: 'ignore',
    categoryId: null,
    targetMaterialId: null,
    targetUnit: null,
    unitMismatchAcknowledged: true,
  };
}

export function applyMaterialPriceImportBulkActionWithResult(
  state: MaterialPriceImportState,
  decision: MaterialPriceImportBulkDecision,
): MaterialPriceImportBulkActionResult {
  const categoryId = decision.action === 'create'
    // Null is the caller's explicit Uncategorised choice. The UI keeps an
    // unchosen category separate from this closed decision.
    ? decision.categoryId === null
      ? null
      : requireCategory(decision.categoryId)
    : null;
  const affectedRowIds: number[] = [];
  const ineligibleRowIds: number[] = [];
  const rows = state.rows.map((row) => {
    if (!row.selected) return row;
    if (!isEligibleForBulkDecision(row, decision)) {
      ineligibleRowIds.push(row.id);
      return row;
    }
    affectedRowIds.push(row.id);
    return applyEligibleBulkDecision(row, decision, categoryId);
  });

  return {
    state: { ...state, rows },
    affectedRowIds,
    ineligibleRowIds,
    affectedCount: affectedRowIds.length,
    ineligibleCount: ineligibleRowIds.length,
  };
}

export function resetMaterialPriceImportRowDecision(
  state: MaterialPriceImportState,
  id: number,
): MaterialPriceImportState {
  const source = state.rows.find((row) => row.id === id);
  if (!source) return state;
  return updateRow(state, id, () => initialRow(source, state.materials));
}

export function canConfirmMaterialPriceImport(
  state: MaterialPriceImportState,
): boolean {
  const selectedRows = state.rows.filter((row) => row.selected);
  const resolved = selectedRows.length > 0 && selectedRows.every((row) => (
    row.action !== 'unresolved'
    && (
      row.action !== 'update'
      || !hasUnitMismatch(row.sourceUnit, row.targetUnit)
      || row.unitMismatchAcknowledged
    )
  ));
  return resolved;
}

export function hasDuplicateMaterialPriceImportCreates(
  state: MaterialPriceImportState,
  drafts: readonly {
    rowIndex: number;
    createDraft: Pick<
      MaterialPriceImportCreateDraft,
      'name' | 'supplier' | 'partNumber'
    >;
  }[],
): boolean {
  const seen = new Set<string>();
  for (const row of state.rows) {
    if (row.action !== 'create') continue;
    const draft = drafts.find(({ rowIndex }) => rowIndex === row.id)?.createDraft;
    if (!draft) continue;
    const supplier = materialPriceComparisonKey(draft.supplier);
    const part = materialPriceComparisonKey(draft.partNumber);
    const identity = supplier && part
      ? JSON.stringify(['supplier_part', supplier, part])
      : JSON.stringify(['name', materialPriceComparisonKey(draft.name)]);
    if (seen.has(identity)) return true;
    seen.add(identity);
  }
  return false;
}

export function materialPriceImportResultSummary(
  state: MaterialPriceImportState,
): { updated: number; created: number; ignored: number; total: number } {
  const updated = state.rows.filter((row) => (
    row.selected && row.action === 'update'
  )).length;
  const created = state.rows.filter((row) => (
    row.selected && row.action === 'create'
  )).length;
  return {
    updated,
    created,
    ignored: state.rows.length - updated - created,
    total: state.rows.length,
  };
}
import {
  materialPriceComparisonKey,
  type MaterialPriceImportCreateDraft,
} from '../../shared/materialPriceImport';
