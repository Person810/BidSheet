import { describe, expect, it } from 'vitest';

import type { MaterialPriceImportReviewRow } from '../../shared/materialPriceImport';
import type { MaterialPriceImportRequest } from '../../shared/types/ipc';
import { buildMaterialPriceImportRequest } from './materialPriceImportCommit';
import {
  createMaterialPriceImportState,
  type MaterialPriceImportAction,
  type MaterialPriceImportClassification,
  type MaterialPriceImportState,
} from './materialPriceImportState';

function reviewRow(
  rowIndex: number,
  changes: Partial<MaterialPriceImportReviewRow> = {},
): MaterialPriceImportReviewRow {
  return {
    rowIndex,
    classification: 'unmatched',
    proposedAction: 'unresolved',
    allowedActions: ['create', 'match', 'ignore'],
    candidateMaterialIds: [],
    targetMaterialId: null,
    matchReasons: [],
    conflicts: [],
    unitCost: rowIndex + 0.5,
    importedUnit: 'EA',
    existingUnit: null,
    unitMismatch: false,
    priceChanged: true,
    proposedUpdate: null,
    createDraft: {
      name: `Imported material ${rowIndex}`,
      unit: 'EA',
      supplier: `Supplier ${rowIndex}`,
      partNumber: `PART-${rowIndex}`,
      description: `Description ${rowIndex}`,
      categoryId: null,
      categoryName: 'Imported category',
    },
    validationMessages: [],
    ...changes,
  };
}

function stateFor(
  drafts: readonly MaterialPriceImportReviewRow[],
  actions: readonly {
    action: MaterialPriceImportAction;
    targetMaterialId?: number | null;
    categoryId?: number | null;
    selected?: boolean;
    classification?: MaterialPriceImportClassification;
  }[],
): MaterialPriceImportState {
  const state = createMaterialPriceImportState(
    drafts.map((draft, index) => ({
      id: draft.rowIndex,
      description: draft.createDraft.name,
      price: draft.unitCost,
      unit: draft.importedUnit,
      classification: actions[index]?.classification
        ?? (draft.classification === 'ambiguous' ? 'review' : draft.classification),
      proposedMaterialId: null,
    })),
    [{ id: 91, name: 'Existing material', unit: 'EA', categoryId: 7 }],
  );
  return {
    ...state,
    rows: state.rows.map((row, index) => ({
      ...row,
      action: actions[index].action,
      targetMaterialId: actions[index].targetMaterialId ?? null,
      categoryId: actions[index].categoryId ?? null,
      selected: actions[index].selected ?? false,
      unitMismatchAcknowledged: true,
    })),
  };
}

function build(
  state: MaterialPriceImportState,
  drafts: readonly MaterialPriceImportReviewRow[],
): MaterialPriceImportRequest {
  return buildMaterialPriceImportRequest('supplier.csv', state, drafts);
}

describe('material price import commit request', () => {
  it('submits only the selected non-contiguous create and update subset in state order', () => {
    const drafts = [
      reviewRow(7),
      reviewRow(3, { classification: 'matched' }),
      reviewRow(11),
      reviewRow(19, { classification: 'matched' }),
    ];
    const state = stateFor(drafts, [
      { action: 'create', categoryId: 44, selected: true },
      { action: 'update', targetMaterialId: 91, selected: false },
      { action: 'unresolved', selected: false },
      { action: 'update', targetMaterialId: 91, selected: true },
    ]);

    const request = build(state, drafts);

    expect(request.source).toBe('supplier.csv');
    expect(request.rows).toHaveLength(2);
    expect(request.rows.map((row) => row.rowIndex)).toEqual([7, 19]);
    expect(request.rows[0]).toMatchObject({
      rowIndex: 7,
      action: 'create',
      categoryId: 44,
      name: 'Imported material 7',
      unitCost: 7.5,
    });
    expect(request.rows[1]).toMatchObject({
      rowIndex: 19,
      action: 'update',
      targetMaterialId: 91,
      acknowledgeUnitMismatch: true,
    });
  });

  it('omits unselected unresolved, create, update, ignore, and invalid rows', () => {
    const drafts = [
      reviewRow(0),
      reviewRow(1),
      reviewRow(2, { classification: 'matched' }),
      reviewRow(3),
      reviewRow(4, { classification: 'invalid' }),
      reviewRow(5),
    ];
    const request = build(stateFor(drafts, [
      { action: 'unresolved', selected: false },
      { action: 'create', categoryId: 8, selected: false },
      { action: 'update', targetMaterialId: 91, selected: false },
      { action: 'ignore', selected: false },
      { action: 'ignore', classification: 'invalid', selected: false },
      { action: 'create', categoryId: 8, selected: true },
    ]), drafts);

    expect(request.rows).toHaveLength(1);
    expect(request.rows[0]).toMatchObject({ rowIndex: 5, action: 'create' });
  });

  it('does not serialize transient selection in any submitted row', () => {
    const drafts = [reviewRow(0), reviewRow(1, { classification: 'matched' })];
    const request = build(stateFor(drafts, [
      { action: 'create', categoryId: 8, selected: true },
      { action: 'update', targetMaterialId: 91, selected: true },
    ]), drafts);

    expect(request.rows.every((row) => !Object.hasOwn(row, 'selected'))).toBe(true);
  });

  it('preserves exact category IDs and null Uncategorised on selected creates', () => {
    const drafts = [reviewRow(2), reviewRow(9), reviewRow(12)];
    const state = stateFor(drafts, [
      { action: 'create', categoryId: 73, selected: true },
      { action: 'create', categoryId: null, selected: true },
      { action: 'create', categoryId: 8, selected: false },
    ]);

    const request = build(state, drafts);

    expect(request.rows).toHaveLength(2);
    expect(request.rows.map((row) => (
      row.action === 'create' ? row.categoryId : 'not-create'
    ))).toEqual([73, null]);
  });

  it('rejects an empty selection with an exact user-facing reason', () => {
    const drafts = [reviewRow(0), reviewRow(1)];
    const state = stateFor(drafts, [
      { action: 'create', categoryId: 4, selected: false },
      { action: 'unresolved', selected: false },
    ]);

    expect(() => build(state, drafts))
      .toThrow('Select at least one row to import.');
  });

  it('rejects a selected unresolved row but ignores an unselected unresolved row', () => {
    const drafts = [reviewRow(0), reviewRow(1)];
    const state = stateFor(drafts, [
      { action: 'unresolved', selected: true },
      { action: 'unresolved', selected: false },
    ]);

    expect(() => build(state, drafts)).toThrow(/row 1|unresolved|decision/i);
  });

  it.each([
    {
      label: 'invalid',
      action: 'ignore' as const,
      classification: 'invalid' as const,
      expected: /invalid.*selected|selected.*invalid/i,
    },
    {
      label: 'ignore',
      action: 'ignore' as const,
      classification: 'unmatched' as const,
      expected: /selected.*ignore|ignore.*selected/i,
    },
  ])('rejects a selected $label row', ({ action, classification, expected }) => {
    const drafts = [reviewRow(6, { classification })];
    const state = stateFor(drafts, [{
      action,
      classification,
      selected: true,
    }]);

    expect(() => build(state, drafts)).toThrow(expected);
  });

  it('rejects a selected state row whose corresponding review draft is absent', () => {
    const drafts = [reviewRow(0), reviewRow(1)];
    const state = stateFor(drafts, [
      { action: 'create', categoryId: 9, selected: false },
      { action: 'create', categoryId: 9, selected: true },
    ]);

    expect(() => build(state, drafts.slice(0, 1)))
      .toThrow(/row.*available|missing/i);
  });

  it('does not require a draft for an unselected state row', () => {
    const drafts = [reviewRow(0), reviewRow(1)];
    const state = stateFor(drafts, [
      { action: 'create', categoryId: 9, selected: true },
      { action: 'unresolved', selected: false },
    ]);

    const request = build(state, drafts.slice(0, 1));

    expect(request.rows.map((row) => row.rowIndex)).toEqual([0]);
  });
});
