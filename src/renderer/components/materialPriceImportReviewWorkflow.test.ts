import { describe, expect, it } from 'vitest';

import {
  applyMaterialPriceImportBulkActionWithResult,
  canConfirmMaterialPriceImport,
  createMaterialPriceImportState,
  materialPriceImportResultSummary,
  materialPriceImportVisibleSelection,
  setMaterialPriceImportFilter,
  setMaterialPriceImportManualTarget,
  setMaterialPriceImportRowAction,
  setMaterialPriceImportShownSelection,
  toggleMaterialPriceImportRow,
  type MaterialPriceImportCandidate,
  type MaterialPriceImportClassification,
  type MaterialPriceImportSourceRow,
  type MaterialPriceImportState,
} from './materialPriceImportState';

const categoryId = 7;
const materials: MaterialPriceImportCandidate[] = [
  { id: 10, name: 'Known EA', unit: 'EA', categoryId: 2 },
  { id: 11, name: 'Known LF', unit: 'LF', categoryId: 3 },
];

function source(
  id: number,
  classification: MaterialPriceImportClassification = 'unmatched',
  defaultCreateCategoryId: number | null = categoryId,
): MaterialPriceImportSourceRow {
  return {
    id,
    description: `Imported material ${id}`,
    price: id + 0.5,
    unit: 'EA',
    classification,
    proposedMaterialId: classification === 'matched' ? 10 : null,
    defaultCreateCategoryId,
  };
}

function state(rows: readonly MaterialPriceImportSourceRow[]) {
  return createMaterialPriceImportState(rows, materials);
}

function rowsById(value: MaterialPriceImportState) {
  return new Map(value.rows.map((row) => [row.id, row]));
}

describe('filtered material import review selection', () => {
  it('selects shown unmatched rows as Create with their inferred categories', () => {
    const original = setMaterialPriceImportFilter(state([
      source(0, 'matched'),
      source(1, 'unmatched', 71),
      source(2, 'unmatched', 72),
      source(3, 'review'),
      source(4, 'invalid'),
    ]), 'unmatched');

    const selected = setMaterialPriceImportShownSelection(original, true);
    expect(materialPriceImportVisibleSelection(selected)).toEqual({
      selected: 2,
      shown: 2,
    });
    expect(selected.rows.map((row) => [row.id, row.selected])).toEqual([
      [0, true],
      [1, true],
      [2, true],
      [3, false],
      [4, false],
    ]);
    expect(rowsById(selected).get(1)).toMatchObject({
      selected: true,
      action: 'create',
      categoryId: 71,
    });
    expect(rowsById(selected).get(2)).toMatchObject({
      selected: true,
      action: 'create',
      categoryId: 72,
    });
    expect(original.rows[1]).toMatchObject({
      selected: false,
      action: 'unresolved',
    });

    const deselected = setMaterialPriceImportShownSelection(selected, false);
    expect(materialPriceImportVisibleSelection(deselected)).toEqual({
      selected: 0,
      shown: 2,
    });
    expect(deselected.rows.map((row) => [row.id, row.selected])).toEqual([
      [0, true],
      [1, false],
      [2, false],
      [3, false],
      [4, false],
    ]);
    expect(rowsById(deselected).get(1)).toMatchObject({
      selected: false,
      action: 'create',
      categoryId: 71,
    });
  });

  it('defaults one selected unmatched row without an inferred category to Uncategorised', () => {
    const original = state([source(8, 'unmatched', null)]);
    const selected = toggleMaterialPriceImportRow(original, 8);

    expect(selected.rows[0]).toMatchObject({
      selected: true,
      action: 'create',
      categoryId: null,
    });
    expect(canConfirmMaterialPriceImport(selected)).toBe(true);
  });

  it('preserves a create decision across deselect and reselect', () => {
    const original = state([source(9, 'unmatched', 81)]);
    const selected = toggleMaterialPriceImportRow(original, 9);
    const deselected = toggleMaterialPriceImportRow(selected, 9);
    const reselected = toggleMaterialPriceImportRow(deselected, 9);

    expect(deselected.rows[0]).toMatchObject({
      selected: false,
      action: 'create',
      categoryId: 81,
    });
    expect(reselected.rows[0]).toMatchObject({
      selected: true,
      action: 'create',
      categoryId: 81,
    });
  });

  it('excludes invalid rows even under the All filter', () => {
    const original = state([
      source(0, 'unmatched'),
      source(1, 'invalid'),
      source(2, 'review'),
    ]);
    const selected = setMaterialPriceImportShownSelection(original, true);

    expect(materialPriceImportVisibleSelection(selected)).toEqual({
      selected: 2,
      shown: 2,
    });
    expect(selected.rows.map((row) => row.selected)).toEqual([true, false, true]);
    expect(original.rows.map((row) => row.selected)).toEqual([false, false, false]);
  });
});

describe.each([38, 100])(
  '%i-row all-unmatched supplier import',
  (rowCount) => {
    it('is immediately confirmable after Select all shown', () => {
      const original = setMaterialPriceImportFilter(
        state(Array.from({ length: rowCount }, (_, id) => source(id))),
        'unmatched',
      );
      expect(canConfirmMaterialPriceImport(original)).toBe(false);

      const selected = setMaterialPriceImportShownSelection(original, true);
      expect(materialPriceImportVisibleSelection(selected)).toEqual({
        selected: rowCount,
        shown: rowCount,
      });
      expect(selected.rows).toHaveLength(rowCount);
      expect(selected.rows.every((row) => (
        row.action === 'create'
        && row.categoryId === categoryId
        && row.selected
      ))).toBe(true);
      expect(canConfirmMaterialPriceImport(selected)).toBe(true);
      expect(original.rows.every((row) => row.action === 'unresolved')).toBe(true);
    });
  },
);

describe('selection is the import inclusion boundary', () => {
  it('derives only safe defaults in a mixed Select all transition', () => {
    const original = state([
      source(0, 'matched'),
      source(1, 'unmatched', 91),
      source(2, 'review'),
      source(3, 'invalid'),
    ]);
    const selected = setMaterialPriceImportShownSelection(original, true);

    expect(rowsById(selected).get(0)).toMatchObject({
      selected: true,
      action: 'update',
      targetMaterialId: 10,
    });
    expect(rowsById(selected).get(1)).toMatchObject({
      selected: true,
      action: 'create',
      categoryId: 91,
    });
    expect(rowsById(selected).get(2)).toMatchObject({
      selected: true,
      action: 'unresolved',
    });
    expect(rowsById(selected).get(3)).toMatchObject({
      selected: false,
      action: 'ignore',
    });
    expect(canConfirmMaterialPriceImport(selected)).toBe(false);

    const withoutAmbiguous = toggleMaterialPriceImportRow(selected, 2);
    expect(canConfirmMaterialPriceImport(withoutAmbiguous)).toBe(true);
  });

  it('summarizes selected writes and treats unselected proposals as ignored', () => {
    let mixed = state([
      source(0, 'matched'),
      source(1, 'unmatched', 92),
      source(2, 'unmatched', 93),
      source(3, 'invalid'),
    ]);
    mixed = toggleMaterialPriceImportRow(mixed, 1);

    expect(materialPriceImportResultSummary(mixed)).toEqual({
      updated: 1,
      created: 1,
      ignored: 2,
      total: 4,
    });
  });
});

describe('action-specific bulk decisions', () => {
  it('reports automatically created and manually matched rows as Bulk Create ineligible', () => {
    let selected = state([
      source(0),
      source(1),
      source(2, 'review'),
      source(3, 'invalid'),
    ]);
    selected = setMaterialPriceImportShownSelection(selected, true);
    selected = setMaterialPriceImportManualTarget(selected, 1, 10);

    const result = applyMaterialPriceImportBulkActionWithResult(selected, {
      action: 'create',
      categoryId,
    });

    expect(result).toMatchObject({
      affectedCount: 0,
      ineligibleCount: 3,
      affectedRowIds: [],
      ineligibleRowIds: [0, 1, 2],
    });
    expect(rowsById(result.state).get(0)).toMatchObject({
      action: 'create',
      categoryId,
    });
    expect(rowsById(result.state).get(1)).toMatchObject({
      action: 'update',
      targetMaterialId: 10,
    });
    expect(rowsById(result.state).get(2)?.action).toBe('unresolved');
    expect(rowsById(result.state).get(3)).toMatchObject({
      action: 'ignore',
      selected: false,
    });
  });

  it('repeated Bulk Create is deterministic and reports already-created rows ineligible', () => {
    const selected = setMaterialPriceImportShownSelection(
      state([source(0), source(1)]),
      true,
    );
    const first = applyMaterialPriceImportBulkActionWithResult(selected, {
      action: 'create',
      categoryId,
    });
    const second = applyMaterialPriceImportBulkActionWithResult(first.state, {
      action: 'create',
      categoryId: 9,
    });

    expect(second).toMatchObject({
      affectedCount: 0,
      ineligibleCount: 2,
      affectedRowIds: [],
      ineligibleRowIds: [0, 1],
    });
    expect(second.state).toEqual(first.state);
  });

  it('Ignore selected replaces unresolved, Create and Update decisions', () => {
    let mixed = state([
      source(0),
      source(1),
      source(2, 'matched'),
      source(3, 'review'),
      source(4, 'invalid'),
      source(5),
    ]);
    mixed = setMaterialPriceImportRowAction(mixed, 1, {
      action: 'create',
      categoryId,
    });
    mixed = setMaterialPriceImportManualTarget(mixed, 3, 10);
    mixed = toggleMaterialPriceImportRow(mixed, 0);
    // Matched rows start selected; row 5 remains deliberately unselected.

    const result = applyMaterialPriceImportBulkActionWithResult(mixed, {
      action: 'ignore',
    });

    expect(result).toMatchObject({
      affectedCount: 4,
      ineligibleCount: 0,
      affectedRowIds: [0, 1, 2, 3],
      ineligibleRowIds: [],
    });
    expect(result.state.rows.slice(0, 4).every((row) => row.action === 'ignore'))
      .toBe(true);
    expect(result.state.rows[4]).toMatchObject({
      classification: 'invalid',
      action: 'ignore',
      selected: false,
    });
    expect(result.state.rows[5]).toMatchObject({
      action: 'unresolved',
      selected: false,
    });
  });

  it('Ignore selected reports selected invalid rows as ineligible without changing them', () => {
    const original = state([source(0), source(1, 'invalid')]);
    const forcedInvalidSelection: MaterialPriceImportState = {
      ...original,
      rows: original.rows.map((row) => (
        row.id === 1 ? { ...row, selected: true } : row
      )),
    };
    const result = applyMaterialPriceImportBulkActionWithResult(
      forcedInvalidSelection,
      { action: 'ignore' },
    );

    expect(result).toMatchObject({
      affectedCount: 0,
      ineligibleCount: 1,
      affectedRowIds: [],
      ineligibleRowIds: [1],
    });
    expect(result.state).toEqual(forcedInvalidSelection);
  });
});
