import { describe, expect, it } from 'vitest';

import type { MaterialPriceImportReviewRow } from '../../shared/materialPriceImport';
import {
  createMaterialPriceImportState,
  setMaterialPriceImportManualTarget,
  setMaterialPriceImportRowAction,
  toggleMaterialPriceImportRow,
  type MaterialPriceImportCandidate,
  type MaterialPriceImportSourceRow,
  type MaterialPriceImportState,
} from './materialPriceImportState';
import {
  evaluateMaterialPriceImportConfirmationBlockers,
  isMaterialPriceImportConfirmationEnabled,
} from './materialPriceImportReviewValidation';

const materials: MaterialPriceImportCandidate[] = [
  { id: 10, name: 'Existing cable', unit: 'M', categoryId: 1 },
  { id: 11, name: 'Existing device', unit: 'EA', categoryId: 2 },
];

function source(
  id: number,
  classification: MaterialPriceImportSourceRow['classification'] = 'unmatched',
): MaterialPriceImportSourceRow {
  return {
    id,
    description: `Safe row ${id}`,
    price: classification === 'invalid' ? null : id + 1,
    unit: 'EA',
    classification,
    proposedMaterialId: classification === 'matched' ? 11 : null,
  };
}

function draft(
  rowIndex: number,
  patch: Partial<MaterialPriceImportReviewRow['createDraft']> = {},
): MaterialPriceImportReviewRow {
  return {
    rowIndex,
    classification: 'unmatched',
    proposedAction: 'create',
    allowedActions: ['create', 'ignore'],
    candidateMaterialIds: [],
    targetMaterialId: null,
    matchReasons: [],
    conflicts: [],
    unitCost: rowIndex + 1,
    importedUnit: 'EA',
    existingUnit: null,
    unitMismatch: false,
    priceChanged: false,
    proposedUpdate: null,
    createDraft: {
      name: `New material ${rowIndex}`,
      unit: 'EA',
      supplier: 'Ordinary supplier',
      partNumber: `PART-${rowIndex}`,
      description: null,
      categoryId: 7,
      categoryName: 'IT Equipment',
      ...patch,
    },
    validationMessages: [],
  };
}

function evaluate(
  state: MaterialPriceImportState,
  drafts: readonly MaterialPriceImportReviewRow[] = [],
  importing = false,
) {
  return evaluateMaterialPriceImportConfirmationBlockers({
    state,
    drafts,
    importing,
  });
}

describe('material price import confirmation blockers', () => {
  it('allows the screenshot shape: one selected valid Create and 37 unselected unresolved rows', () => {
    const rows = Array.from({ length: 38 }, (_, id) => source(id));
    let state = createMaterialPriceImportState(rows, materials);
    state = setMaterialPriceImportRowAction(state, 0, {
      action: 'create',
      categoryId: 7,
    });

    expect(evaluate(state, [draft(0)])).toEqual([]);
  });

  it('has no blocker for one valid create proposal', () => {
    const state = setMaterialPriceImportRowAction(
      createMaterialPriceImportState([source(5)], materials),
      5,
      { action: 'create', categoryId: null },
    );

    expect(evaluate(state, [draft(5, {
      categoryId: null,
      categoryName: 'Uncategorised',
    })])).toEqual([]);
  });

  it('requires at least one selected row with a fixed non-row blocker', () => {
    const state = createMaterialPriceImportState(
      [source(8), source(9, 'invalid')],
      materials,
    );

    expect(evaluate(state, [draft(8), draft(9)])).toEqual([{
      type: 'no_selection',
      rowIds: [],
      count: 1,
      message: 'Select at least one row to import.',
      firstRowId: null,
      firstClassification: null,
    }]);
  });

  it.each([
    ['missing name', { name: '' }, 'name'],
    ['overlong unit', { unit: 'x'.repeat(33) }, 'unit'],
    ['overlong supplier', { supplier: 'x'.repeat(256) }, 'supplier'],
    ['overlong part number', { partNumber: 'x'.repeat(256) }, 'part number'],
    ['overlong description', { description: 'x'.repeat(2_001) }, 'description'],
  ] as const)('groups an invalid create draft for %s by row', (_label, patch, field) => {
    const state = setMaterialPriceImportRowAction(
      createMaterialPriceImportState([source(12)], materials),
      12,
      { action: 'create', categoryId: 7 },
    );

    expect(evaluate(state, [draft(12, patch)])).toEqual([{
      type: 'invalid_create_draft',
      rowIds: [12],
      count: 1,
      message: `1 selected new material has invalid ${field} details.`,
      firstRowId: 12,
      firstClassification: 'unmatched',
    }]);
  });

  it('does not validate an invalid Create draft after that row is deselected', () => {
    const selected = setMaterialPriceImportRowAction(
      createMaterialPriceImportState([source(13), source(14)], materials),
      13,
      { action: 'create', categoryId: 7 },
    );
    const state: MaterialPriceImportState = {
      ...selected,
      rows: selected.rows.map((row) => (
        row.id === 13 ? { ...row, selected: false } : row
      )),
    };
    const withOneValidSelection = setMaterialPriceImportRowAction(state, 14, {
      action: 'create',
      categoryId: 7,
    });

    expect(evaluate(withOneValidSelection, [
      draft(13, { name: '' }),
      draft(14),
    ])).toEqual([]);
  });

  it('groups both rows in a normalized duplicate create proposal', () => {
    let state = createMaterialPriceImportState(
      [source(20), source(21)],
      materials,
    );
    state = setMaterialPriceImportRowAction(state, 20, {
      action: 'create',
      categoryId: null,
    });
    state = setMaterialPriceImportRowAction(state, 21, {
      action: 'create',
      categoryId: null,
    });
    const drafts = [
      draft(20, {
        name: 'Supplier wording A',
        supplier: ' Core & Main ',
        partNumber: 'ＰＶ-100',
      }),
      draft(21, {
        name: 'Supplier wording B',
        supplier: 'ＣＯＲＥ　＆　ＭＡＩＮ',
        partNumber: ' pv-100 ',
      }),
    ];

    expect(evaluate(state, drafts)).toEqual([{
      type: 'duplicate_create',
      rowIds: [20, 21],
      count: 2,
      message: '2 selected new-material rows have duplicate identities.',
      firstRowId: 20,
      firstClassification: 'unmatched',
    }]);
  });

  it('does not report a duplicate when only one duplicate Create is selected', () => {
    let state = createMaterialPriceImportState(
      [source(22), source(23)],
      materials,
    );
    state = setMaterialPriceImportRowAction(state, 22, {
      action: 'create',
      categoryId: null,
    });
    state = setMaterialPriceImportRowAction(state, 23, {
      action: 'create',
      categoryId: null,
    });
    state = {
      ...state,
      rows: state.rows.map((row) => (
        row.id === 23 ? { ...row, selected: false } : row
      )),
    };
    const duplicateDrafts = [
      draft(22, { supplier: 'Core & Main', partNumber: 'PV-100' }),
      draft(23, { supplier: ' core & main ', partNumber: 'pv-100' }),
    ];

    expect(evaluate(state, duplicateDrafts)).toEqual([]);
  });

  it('reports an unacknowledged unit mismatch with its first-row route', () => {
    const review = {
      ...source(30, 'review'),
      unit: 'FT',
    };
    const state = setMaterialPriceImportManualTarget(
      createMaterialPriceImportState([review], materials),
      30,
      10,
    );

    expect(evaluate(state)).toEqual([{
      type: 'unit_mismatch',
      rowIds: [30],
      count: 1,
      message: '1 selected matched row has an unacknowledged unit mismatch.',
      firstRowId: 30,
      firstClassification: 'review',
    }]);
  });

  it('does not report an unacknowledged unit mismatch after deselection', () => {
    const review = {
      ...source(31, 'review'),
      unit: 'FT',
    };
    const selected = setMaterialPriceImportManualTarget(
      createMaterialPriceImportState([review, source(32)], materials),
      31,
      10,
    );
    let state: MaterialPriceImportState = {
      ...selected,
      rows: selected.rows.map((row) => (
        row.id === 31 ? { ...row, selected: false } : row
      )),
    };
    state = setMaterialPriceImportRowAction(state, 32, {
      action: 'create',
      categoryId: 7,
    });

    expect(evaluate(state, [draft(31), draft(32)])).toEqual([]);
  });

  it('blocks a selected ambiguous row until it is deselected', () => {
    const initial = createMaterialPriceImportState(
      [source(35, 'review'), source(36)],
      materials,
    );
    let state = toggleMaterialPriceImportRow(initial, 35);
    state = setMaterialPriceImportRowAction(state, 36, {
      action: 'create',
      categoryId: 7,
    });

    expect(evaluate(state, [draft(35), draft(36)])).toEqual([{
      type: 'unresolved',
      rowIds: [35],
      count: 1,
      message: '1 selected row still needs a decision.',
      firstRowId: 35,
      firstClassification: 'review',
    }]);

    state = toggleMaterialPriceImportRow(state, 35);
    expect(evaluate(state, [draft(35), draft(36)])).toEqual([]);
  });

  it('reports importing without pretending that it routes to a row', () => {
    const state = setMaterialPriceImportRowAction(
      createMaterialPriceImportState([source(40)], materials),
      40,
      { action: 'create', categoryId: 7 },
    );

    expect(evaluate(state, [draft(40)], true)).toEqual([{
      type: 'importing',
      rowIds: [],
      count: 1,
      message: 'The material import is already in progress.',
      firstRowId: null,
      firstClassification: null,
    }]);
  });

  it('enables confirmation exactly when the shared blocker model is empty', () => {
    const unresolved = createMaterialPriceImportState([source(60)], materials);
    const resolved = setMaterialPriceImportRowAction(unresolved, 60, {
      action: 'create',
      categoryId: 7,
    });
    const cases = [
      evaluate(unresolved),
      evaluate(resolved, [draft(60)]),
      evaluate(resolved, [draft(60)], true),
    ];

    expect(cases.map((blockers) => (
      isMaterialPriceImportConfirmationEnabled(blockers)
    ))).toEqual([false, true, false]);
    for (const blockers of cases) {
      expect(isMaterialPriceImportConfirmationEnabled(blockers))
        .toBe(blockers.length === 0);
    }
  });

  it('uses fixed safe labels without source descriptions, supplier data or paths', () => {
    const unsafeDescription = 'Cisco Catalyst / C:\\secret\\supplier.csv';
    const unsafeSupplier = 'Private Supplier Account 123';
    const state = createMaterialPriceImportState([{
      ...source(70),
      description: unsafeDescription,
    }], materials);
    const serialized = JSON.stringify(evaluate(state, [
      draft(70, { supplier: unsafeSupplier }),
    ]));

    expect(serialized).not.toContain(unsafeDescription);
    expect(serialized).not.toContain(unsafeSupplier);
    expect(serialized).not.toContain('C:\\secret');
    expect(serialized).not.toContain('.csv');
  });
});
