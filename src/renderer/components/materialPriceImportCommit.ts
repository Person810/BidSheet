import type { MaterialPriceImportReviewRow } from '../../shared/materialPriceImport';
import type {
  MaterialPriceImportAction as CommitAction,
  MaterialPriceImportCommonAction,
  MaterialPriceImportRequest,
} from '../../shared/types/ipc';
import type {
  MaterialPriceImportRow,
  MaterialPriceImportState,
} from './materialPriceImportState';

function commonFields(
  draft: MaterialPriceImportReviewRow,
): MaterialPriceImportCommonAction {
  return {
    rowIndex: draft.rowIndex,
    name: draft.createDraft.name,
    unitCost: draft.unitCost,
    unit: draft.createDraft.unit,
    supplier: draft.createDraft.supplier,
    partNumber: draft.createDraft.partNumber,
    description: draft.createDraft.description,
    categoryText: draft.createDraft.categoryName || null,
  };
}

function actionForRow(
  row: MaterialPriceImportRow,
  draft: MaterialPriceImportReviewRow,
): CommitAction {
  if (row.classification === 'invalid') {
    throw new Error(
      `Invalid import row ${draft.rowIndex + 1} cannot be selected.`,
    );
  }

  const common = commonFields(draft);
  switch (row.action) {
    case 'update':
      if (row.targetMaterialId === null) {
        throw new Error(`Import row ${draft.rowIndex + 1} needs a material.`);
      }
      return {
        ...common,
        action: 'update',
        targetMaterialId: row.targetMaterialId,
        acknowledgeUnitMismatch: row.unitMismatchAcknowledged,
      };
    case 'create':
      return {
        ...common,
        action: 'create',
        categoryId: row.categoryId,
      };
    case 'ignore':
      throw new Error(
        `Selected import row ${draft.rowIndex + 1} cannot be ignored.`,
      );
    case 'unresolved':
      throw new Error(
        `Import row ${draft.rowIndex + 1} still needs a decision.`,
      );
  }
}

export function buildMaterialPriceImportRequest(
  source: string,
  state: MaterialPriceImportState,
  drafts: readonly MaterialPriceImportReviewRow[],
): MaterialPriceImportRequest {
  const draftsByIndex = new Map(
    drafts.map((draft) => [draft.rowIndex, draft]),
  );
  const selectedRows = state.rows.filter((row) => row.selected);
  if (selectedRows.length === 0) {
    throw new Error('Select at least one row to import.');
  }
  const rows = selectedRows.map((row) => {
    const draft = draftsByIndex.get(row.id);
    if (!draft) {
      throw new Error(`Import row ${row.id + 1} is no longer available.`);
    }
    return actionForRow(row, draft);
  });

  return { source, rows };
}
