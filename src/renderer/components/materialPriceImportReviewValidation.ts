import {
  materialPriceComparisonKey,
  type MaterialPriceImportCreateDraft,
  type MaterialPriceImportReviewRow,
} from '../../shared/materialPriceImport';
import type {
  MaterialPriceImportClassification,
  MaterialPriceImportState,
} from './materialPriceImportState';

export type MaterialPriceImportConfirmationBlockerType =
  | 'no_selection'
  | 'unresolved'
  | 'invalid_create_draft'
  | 'duplicate_create'
  | 'unit_mismatch'
  | 'importing';

export interface MaterialPriceImportConfirmationBlocker {
  type: MaterialPriceImportConfirmationBlockerType;
  rowIds: number[];
  count: number;
  message: string;
  firstRowId: number | null;
  firstClassification: MaterialPriceImportClassification | null;
}

export interface EvaluateMaterialPriceImportConfirmationBlockersInput {
  state: MaterialPriceImportState;
  drafts: readonly MaterialPriceImportReviewRow[];
  importing: boolean;
}

type CreateDraftField =
  | 'name'
  | 'unit'
  | 'supplier'
  | 'part number'
  | 'description';

function rowBlocker(
  type: MaterialPriceImportConfirmationBlockerType,
  rowIds: number[],
  state: MaterialPriceImportState,
  message: string,
): MaterialPriceImportConfirmationBlocker {
  const first = state.rows.find(({ id }) => id === rowIds[0]);
  return {
    type,
    rowIds,
    count: rowIds.length,
    message,
    firstRowId: first?.id ?? null,
    firstClassification: first?.classification ?? null,
  };
}

function invalidCreateDraftField(
  draft: MaterialPriceImportCreateDraft | undefined,
  price: number | null,
): CreateDraftField | 'price' | null {
  if (!draft || !draft.name.trim() || draft.name.length > 255) return 'name';
  if (!draft.unit.trim() || draft.unit.length > 32) return 'unit';
  if ((draft.supplier?.length ?? 0) > 255) return 'supplier';
  if ((draft.partNumber?.length ?? 0) > 255) return 'part number';
  if ((draft.description?.length ?? 0) > 2_000) return 'description';
  if (price === null || !Number.isFinite(price)) return 'price';
  return null;
}

function createIdentity(draft: MaterialPriceImportCreateDraft): string {
  const supplier = materialPriceComparisonKey(draft.supplier);
  const part = materialPriceComparisonKey(draft.partNumber);
  return supplier && part
    ? JSON.stringify(['supplier_part', supplier, part])
    : JSON.stringify(['name', materialPriceComparisonKey(draft.name)]);
}

function duplicateCreateRowIds(
  state: MaterialPriceImportState,
  drafts: ReadonlyMap<number, MaterialPriceImportCreateDraft>,
): number[] {
  const identities = new Map<string, number[]>();
  for (const row of state.rows) {
    if (row.action !== 'create') continue;
    const draft = drafts.get(row.id);
    if (!draft) continue;
    const identity = createIdentity(draft);
    const ids = identities.get(identity) ?? [];
    ids.push(row.id);
    identities.set(identity, ids);
  }
  return [...identities.values()]
    .filter((ids) => ids.length > 1)
    .flat();
}

function unitsDiffer(source: string | null, target: string | null): boolean {
  const left = materialPriceComparisonKey(source);
  const right = materialPriceComparisonKey(target);
  return left !== '' && right !== '' && left !== right;
}

export function evaluateMaterialPriceImportConfirmationBlockers({
  state,
  drafts,
  importing,
}: EvaluateMaterialPriceImportConfirmationBlockersInput): MaterialPriceImportConfirmationBlocker[] {
  const blockers: MaterialPriceImportConfirmationBlocker[] = [];
  const draftsByRow = new Map(
    drafts.map(({ rowIndex, createDraft }) => [rowIndex, createDraft]),
  );
  const selectedRows = state.rows.filter((row) => row.selected);

  if (selectedRows.length === 0) {
    blockers.push({
      type: 'no_selection',
      rowIds: [],
      count: 1,
      message: 'Select at least one row to import.',
      firstRowId: null,
      firstClassification: null,
    });
  }

  const unresolvedIds = selectedRows
    .filter((row) => row.classification !== 'invalid' && row.action === 'unresolved')
    .map(({ id }) => id);
  if (unresolvedIds.length > 0) {
    const subject = unresolvedIds.length === 1
      ? '1 selected row'
      : `${unresolvedIds.length} selected rows`;
    blockers.push(rowBlocker(
      'unresolved',
      unresolvedIds,
      state,
      `${subject} still need${unresolvedIds.length === 1 ? 's' : ''} a decision.`,
    ));
  }

  const invalidCreateRows = selectedRows
    .filter((row) => row.action === 'create')
    .map((row) => ({
      id: row.id,
      field: invalidCreateDraftField(draftsByRow.get(row.id), row.price),
    }))
    .filter((result): result is { id: number; field: CreateDraftField | 'price' } => (
      result.field !== null
    ));
  if (invalidCreateRows.length > 0) {
    const field = invalidCreateRows.every(
      ({ field: candidate }) => candidate === invalidCreateRows[0].field,
    )
      ? ` ${invalidCreateRows[0].field}`
      : '';
    const subject = invalidCreateRows.length === 1
      ? '1 selected new material has'
      : `${invalidCreateRows.length} selected new materials have`;
    blockers.push(rowBlocker(
      'invalid_create_draft',
      invalidCreateRows.map(({ id }) => id),
      state,
      `${subject} invalid${field} details.`,
    ));
  }

  const duplicateIds = duplicateCreateRowIds({
    ...state,
    rows: selectedRows,
  }, draftsByRow);
  if (duplicateIds.length > 0) {
    blockers.push(rowBlocker(
      'duplicate_create',
      duplicateIds,
      state,
      `${duplicateIds.length} selected new-material rows have duplicate identities.`,
    ));
  }

  const mismatchIds = selectedRows
    .filter((row) => (
      row.action === 'update'
      && unitsDiffer(row.sourceUnit, row.targetUnit)
      && !row.unitMismatchAcknowledged
    ))
    .map(({ id }) => id);
  if (mismatchIds.length > 0) {
    const subject = mismatchIds.length === 1
      ? '1 selected matched row has'
      : `${mismatchIds.length} selected matched rows have`;
    blockers.push(rowBlocker(
      'unit_mismatch',
      mismatchIds,
      state,
      `${subject} an unacknowledged unit mismatch.`,
    ));
  }

  if (importing) {
    blockers.push({
      type: 'importing',
      rowIds: [],
      count: 1,
      message: 'The material import is already in progress.',
      firstRowId: null,
      firstClassification: null,
    });
  }

  return blockers;
}

export function isMaterialPriceImportConfirmationEnabled(
  blockers: readonly MaterialPriceImportConfirmationBlocker[],
): boolean {
  return blockers.length === 0;
}
