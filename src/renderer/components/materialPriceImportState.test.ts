import { describe, expect, it } from 'vitest';

import * as materialPriceImportState from './materialPriceImportState';
import {
  acknowledgeMaterialPriceImportUnitMismatch,
  applyMaterialPriceImportBulkAction,
  canConfirmMaterialPriceImport,
  createMaterialPriceImportState,
  filterMaterialPriceImportRows,
  materialPriceImportResultSummary,
  resetMaterialPriceImportRowDecision,
  setMaterialPriceImportManualTarget,
  setMaterialPriceImportRowAction,
  setMaterialPriceImportShownSelection,
  setMaterialPriceImportFilter,
  toggleMaterialPriceImportRow,
  type MaterialPriceImportCandidate,
  type MaterialPriceImportSourceRow,
} from './materialPriceImportState';

const materials: MaterialPriceImportCandidate[] = [
  { id: 10, name: '8" PVC', unit: 'LF', categoryId: 1 },
  { id: 11, name: '4" Gate Valve', unit: 'EA', categoryId: 2 },
];

const sourceRows: MaterialPriceImportSourceRow[] = [
  {
    id: 0,
    description: '8" PVC',
    price: 12.5,
    unit: 'LF',
    classification: 'matched',
    proposedMaterialId: 10,
  },
  {
    id: 1,
    description: 'Unknown fitting',
    price: 8,
    unit: 'EA',
    classification: 'unmatched',
    proposedMaterialId: null,
  },
  {
    id: 2,
    description: 'Possible valve',
    price: 50,
    unit: 'EA',
    classification: 'review',
    proposedMaterialId: 11,
  },
  {
    id: 3,
    description: 'Broken price',
    price: null,
    unit: 'EA',
    classification: 'invalid',
    proposedMaterialId: null,
  },
];

function initial() {
  return createMaterialPriceImportState(sourceRows, materials);
}

interface EditedCreateDraft {
  rowIndex: number;
  createDraft: {
    name: string;
    supplier: string | null;
    partNumber: string | null;
  };
}

const hasDuplicateMaterialPriceImportCreates = (
  materialPriceImportState as typeof materialPriceImportState & {
    hasDuplicateMaterialPriceImportCreates: (
      state: ReturnType<typeof initial>,
      drafts: readonly EditedCreateDraft[],
    ) => boolean;
  }
).hasDuplicateMaterialPriceImportCreates;

describe('material price import review state', () => {
  it('keeps filters and selection immutable', () => {
    const original = initial();
    const filtered = setMaterialPriceImportFilter(original, 'unmatched');
    const selected = toggleMaterialPriceImportRow(filtered, 1);

    expect(original.filter).toBe('all');
    expect(original.rows.find((row) => row.id === 1)?.selected).toBe(false);
    expect(filtered.filter).toBe('unmatched');
    expect(filtered.rows.find((row) => row.id === 1)?.selected).toBe(false);
    expect(selected.rows.find((row) => row.id === 1)?.selected).toBe(true);
    expect(filterMaterialPriceImportRows(selected).map((row) => row.id)).toEqual([1]);
  });

  it('proposes a unique matched row as an update without committing it', () => {
    const row = initial().rows[0];

    expect(row).toMatchObject({
      classification: 'matched',
      action: 'update',
      targetMaterialId: 10,
      selected: true,
    });
    expect(materials[0]).toEqual({
      id: 10,
      name: '8" PVC',
      unit: 'LF',
      categoryId: 1,
    });
  });

  it('leaves unmatched and review rows unresolved with explicit choices', () => {
    const state = initial();

    expect(state.rows[1]).toMatchObject({
      classification: 'unmatched',
      action: 'unresolved',
      targetMaterialId: null,
    });
    expect(state.rows[2]).toMatchObject({
      classification: 'review',
      action: 'unresolved',
      targetMaterialId: null,
    });

    expect(setMaterialPriceImportRowAction(state, 1, {
      action: 'create',
      categoryId: 7,
    }).rows[1]).toMatchObject({ action: 'create', categoryId: 7 });
    expect(setMaterialPriceImportManualTarget(state, 1, 11).rows[1])
      .toMatchObject({ action: 'update', targetMaterialId: 11 });
    expect(setMaterialPriceImportRowAction(state, 1, { action: 'ignore' }).rows[1])
      .toMatchObject({ action: 'ignore', targetMaterialId: null });
  });

  it('makes invalid rows ignore-only', () => {
    const state = initial();
    const invalid = state.rows[3];

    expect(invalid).toMatchObject({
      classification: 'invalid',
      action: 'ignore',
      selected: false,
    });
    expect(() => setMaterialPriceImportRowAction(state, 3, {
      action: 'create',
      categoryId: 7,
    })).toThrow(/invalid|ignore/i);
    expect(() => setMaterialPriceImportManualTarget(state, 3, 10))
      .toThrow(/invalid|ignore/i);
  });

  it('allows one new material to use the lazy Uncategorised fallback', () => {
    const created = setMaterialPriceImportRowAction(initial(), 1, {
      action: 'create',
      categoryId: null,
    });
    expect(created.rows[1]).toMatchObject({
      action: 'create',
      categoryId: null,
    });
  });

  it('supports an explicit manual existing-material target', () => {
    const original = initial();
    const resolved = setMaterialPriceImportManualTarget(original, 2, 10);

    expect(resolved.rows[2]).toMatchObject({
      classification: 'review',
      action: 'update',
      targetMaterialId: 10,
      selected: true,
    });
    expect(original.rows[2]).toMatchObject({
      action: 'unresolved',
      targetMaterialId: null,
    });
  });

  it('requires acknowledgement before confirming a real unit mismatch', () => {
    const state = setMaterialPriceImportManualTarget(initial(), 2, 10);
    const otherwiseResolved = setMaterialPriceImportRowAction(state, 1, {
      action: 'ignore',
    });

    expect(otherwiseResolved.rows[2]).toMatchObject({
      sourceUnit: 'EA',
      targetUnit: 'LF',
      unitMismatchAcknowledged: false,
    });
    expect(canConfirmMaterialPriceImport(otherwiseResolved)).toBe(false);

    const acknowledged = acknowledgeMaterialPriceImportUnitMismatch(
      otherwiseResolved,
      2,
    );
    expect(acknowledged.rows[2].unitMismatchAcknowledged).toBe(true);
    expect(canConfirmMaterialPriceImport(acknowledged)).toBe(true);
  });

  it('bulk-creates only selected eligible unmatched rows with an explicit category', () => {
    const selected = toggleMaterialPriceImportRow(initial(), 1);
    const bulk = applyMaterialPriceImportBulkAction(selected, {
      action: 'create',
      categoryId: 7,
    });

    expect(bulk.rows[1]).toMatchObject({
      action: 'create',
      categoryId: 7,
      selected: true,
    });
    expect(bulk.rows[2].action).toBe('unresolved');
    expect(bulk.rows[3]).toMatchObject({ action: 'ignore', categoryId: null });
    expect(() => applyMaterialPriceImportBulkAction(selected, {
      action: 'create',
      categoryId: null,
    })).toThrow(/category/i);
  });

  it('bulk-ignore affects selected unresolved eligible rows only', () => {
    const selectedUnmatched = toggleMaterialPriceImportRow(initial(), 1);
    const selectedBoth = toggleMaterialPriceImportRow(selectedUnmatched, 2);
    const ignored = applyMaterialPriceImportBulkAction(selectedBoth, {
      action: 'ignore',
    });

    expect(ignored.rows[1].action).toBe('ignore');
    expect(ignored.rows[2].action).toBe('ignore');
    expect(ignored.rows[0]).toMatchObject({
      action: 'update',
      targetMaterialId: 10,
    });
  });

  it('allows create, match and ignore decisions to be reversed before confirm', () => {
    const created = setMaterialPriceImportRowAction(initial(), 1, {
      action: 'create',
      categoryId: 7,
    });
    const resetCreate = resetMaterialPriceImportRowDecision(created, 1);
    const matched = setMaterialPriceImportManualTarget(resetCreate, 1, 11);
    const resetMatch = resetMaterialPriceImportRowDecision(matched, 1);
    const ignored = setMaterialPriceImportRowAction(resetMatch, 1, {
      action: 'ignore',
    });
    const resetIgnore = resetMaterialPriceImportRowDecision(ignored, 1);

    expect(resetCreate.rows[1].action).toBe('unresolved');
    expect(resetMatch.rows[1].action).toBe('unresolved');
    expect(resetIgnore.rows[1]).toMatchObject({
      action: 'unresolved',
      targetMaterialId: null,
      categoryId: null,
    });
  });

  it('blocks confirm only while a selected actionable row is unresolved', () => {
    expect(canConfirmMaterialPriceImport(initial())).toBe(true);

    const selectedReview = toggleMaterialPriceImportRow(initial(), 2);
    expect(canConfirmMaterialPriceImport(selectedReview)).toBe(false);

    const excludedReview = toggleMaterialPriceImportRow(selectedReview, 2);
    expect(canConfirmMaterialPriceImport(excludedReview)).toBe(true);
  });

  it('blocks confirmation when every row is excluded', () => {
    const excluded = setMaterialPriceImportShownSelection(initial(), false);
    expect(canConfirmMaterialPriceImport(excluded)).toBe(false);
  });

  it('summarizes confirmed update, create, ignore and invalid outcomes', () => {
    const created = setMaterialPriceImportRowAction(initial(), 1, {
      action: 'create',
      categoryId: 7,
    });
    const ignored = setMaterialPriceImportRowAction(created, 2, {
      action: 'ignore',
    });

    expect(materialPriceImportResultSummary(ignored)).toEqual({
      updated: 1,
      created: 1,
      ignored: 2,
      total: 4,
    });
  });
});

describe('material price import convergence guards', () => {
  it('keeps a manually selected FT to LF target as an unacknowledged mismatch', () => {
    const state = createMaterialPriceImportState([
      {
        id: 20,
        description: 'Quoted pipe',
        price: 15,
        unit: 'FT',
        classification: 'review',
        proposedMaterialId: null,
      },
    ], materials);
    const selected = setMaterialPriceImportManualTarget(state, 20, 10);

    expect(selected.rows[0]).toMatchObject({
      sourceUnit: 'FT',
      targetUnit: 'LF',
      unitMismatchAcknowledged: false,
    });
    expect(canConfirmMaterialPriceImport(selected)).toBe(false);
  });

  it.each([
    {
      label: 'normalized supplier plus part number',
      drafts: [
        {
          rowIndex: 30,
          createDraft: {
            name: 'Supplier wording A',
            supplier: ' Core & Main ',
            partNumber: 'ＰＶ-100',
          },
        },
        {
          rowIndex: 31,
          createDraft: {
            name: 'Supplier wording B',
            supplier: 'ＣＯＲＥ　＆　ＭＡＩＮ',
            partNumber: ' pv-100 ',
          },
        },
      ],
      expected: true,
    },
    {
      label: 'normalized fallback material name',
      drafts: [
        {
          rowIndex: 30,
          createDraft: {
            name: ' New Coupling ',
            supplier: null,
            partNumber: null,
          },
        },
        {
          rowIndex: 31,
          createDraft: {
            name: 'ＮＥＷ　ＣＯＵＰＬＩＮＧ',
            supplier: '',
            partNumber: '',
          },
        },
      ],
      expected: true,
    },
    {
      label: 'distinct create identities',
      drafts: [
        {
          rowIndex: 30,
          createDraft: {
            name: 'New Coupling',
            supplier: 'Supplier A',
            partNumber: 'PART-1',
          },
        },
        {
          rowIndex: 31,
          createDraft: {
            name: 'New Coupling',
            supplier: 'Supplier B',
            partNumber: 'PART-2',
          },
        },
      ],
      expected: false,
    },
  ])('detects $label after editable create drafts change', ({ drafts, expected }) => {
    const unresolved = createMaterialPriceImportState([
      {
        id: 30,
        description: 'First new item',
        price: 10,
        unit: 'EA',
        classification: 'unmatched',
        proposedMaterialId: null,
      },
      {
        id: 31,
        description: 'Second new item',
        price: 20,
        unit: 'EA',
        classification: 'unmatched',
        proposedMaterialId: null,
      },
    ], materials);
    const firstCreate = setMaterialPriceImportRowAction(unresolved, 30, {
      action: 'create',
      categoryId: null,
    });
    const bothCreate = setMaterialPriceImportRowAction(firstCreate, 31, {
      action: 'create',
      categoryId: null,
    });

    expect(hasDuplicateMaterialPriceImportCreates(bothCreate, drafts))
      .toBe(expected);
  });
});
