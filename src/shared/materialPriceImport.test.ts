import { describe, expect, it } from 'vitest';

import {
  buildMaterialPriceImportReview,
  materialPriceComparisonKey,
  parseMaterialPrice,
  summarizeMaterialPriceImportResults,
  type ExistingMaterialForPriceImport,
  type MaterialCategoryForPriceImport,
  type MaterialPriceImportOutcome,
  type MaterialPriceImportSourceRow,
} from './materialPriceImport';

function sourceRow(
  rowIndex: number,
  overrides: Partial<MaterialPriceImportSourceRow> = {},
): MaterialPriceImportSourceRow {
  return {
    rowIndex,
    nameText: `Imported material ${rowIndex}`,
    unitCostText: '12.50',
    unitText: 'EA',
    supplierText: 'Supplier A',
    partNumberText: `PART-${rowIndex}`,
    descriptionText: `Description ${rowIndex}`,
    categoryText: 'Pipe',
    ...overrides,
  };
}

function material(
  id: number,
  overrides: Partial<ExistingMaterialForPriceImport> = {},
): ExistingMaterialForPriceImport {
  return {
    id,
    name: `Existing material ${id}`,
    categoryId: 10,
    categoryName: 'Pipe',
    unit: 'EA',
    defaultUnitCost: 10,
    supplier: 'Supplier A',
    partNumber: `EXISTING-${id}`,
    description: null,
    ...overrides,
  };
}

const categories: MaterialCategoryForPriceImport[] = [
  { id: 10, name: 'Pipe' },
  { id: 20, name: 'Valves' },
  { id: 30, name: 'Uncategorised' },
];

describe('strict material price parsing', () => {
  it.each([
    ['0', 0],
    ['  0.00  ', 0],
    ['$1,250.50', 1_250.5],
    ['12', 12],
    ['12.5', 12.5],
    ['.75', 0.75],
  ])('accepts the complete finite non-negative value %j', (raw, expected) => {
    expect(parseMaterialPrice(raw)).toBe(expected);
  });

  it.each([
    '',
    '   ',
    '12abc',
    '12.3.4',
    '$1,23.00',
    '-0.01',
    '-12',
    'NaN',
    'Infinity',
    '-Infinity',
    '1e309',
    '=1+1',
    null,
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('rejects malformed, negative, blank, formula-like or non-finite input %j', (raw) => {
    expect(parseMaterialPrice(raw)).toBeNull();
  });
});

describe('material identity normalization', () => {
  it.each([
    ['  Storm   Pipe  ', 'storm pipe'],
    ['ＳＴＯＲＭ　ＰＩＰＥ', 'storm pipe'],
    ['Core & Main', 'core & main'],
    ['  Québec  ', 'québec'],
    ['日本', '日本'],
    [null, ''],
    [undefined, ''],
  ])('normalizes harmless Unicode, case and spacing for comparison only', (value, expected) => {
    expect(materialPriceComparisonKey(value)).toBe(expected);
  });
});

describe('four-way material price review classification', () => {
  it('classifies every source row exactly once without silently discarding one', () => {
    const review = buildMaterialPriceImportReview(
      [
        sourceRow(0, {
          nameText: 'Existing material 1',
          unitCostText: '15',
          partNumberText: '',
        }),
        sourceRow(1, {
          nameText: 'Brand new valve',
          unitCostText: '25',
          partNumberText: 'NEW-25',
        }),
        sourceRow(2, {
          nameText: '',
          unitCostText: 'not money',
        }),
        sourceRow(3, {
          nameText: 'Duplicate name',
          partNumberText: '',
        }),
      ],
      [
        material(1),
        material(2, { name: 'Duplicate name', partNumber: null }),
        material(3, { name: ' duplicate name ', partNumber: null }),
      ],
      categories,
    );

    expect(review.rows.map(({ rowIndex }) => rowIndex)).toEqual([0, 1, 2, 3]);
    expect(review.rows.map(({ classification }) => classification)).toEqual([
      'matched',
      'unmatched',
      'invalid',
      'ambiguous',
    ]);
    expect(review.counts).toEqual({
      total: 4,
      matched: 1,
      ambiguous: 1,
      unmatched: 1,
      invalid: 1,
    });
  });

  it('proposes update only for one valid, conflict-free exact target', () => {
    const review = buildMaterialPriceImportReview(
      [sourceRow(7, {
        nameText: '  ＥＸＩＳＴＩＮＧ   ＭＡＴＥＲＩＡＬ  1 ',
        unitCostText: '15.25',
        partNumberText: '',
      })],
      [material(1)],
      categories,
    );

    expect(review.rows[0]).toMatchObject({
      rowIndex: 7,
      classification: 'matched',
      proposedAction: 'update',
      candidateMaterialIds: [1],
      targetMaterialId: 1,
      unitCost: 15.25,
      priceChanged: true,
      unitMismatch: false,
    });
    expect(review.rows[0].matchReasons).toContain('name');
  });

  it('keeps an unmatched valid row unresolved with visible imported creation defaults', () => {
    const review = buildMaterialPriceImportReview(
      [sourceRow(4, {
        nameText: '  New hydrant  ',
        unitCostText: '0',
        unitText: '   ',
        supplierText: '  Hydrant Co  ',
        partNumberText: '  H-001  ',
        descriptionText: '  Red hydrant  ',
        categoryText: 'Unknown supplier category',
      })],
      [],
      categories,
    );

    expect(review.rows[0]).toMatchObject({
      classification: 'unmatched',
      proposedAction: 'unresolved',
      candidateMaterialIds: [],
      targetMaterialId: null,
      unitCost: 0,
      createDraft: {
        name: 'New hydrant',
        unit: 'EA',
        supplier: 'Hydrant Co',
        partNumber: 'H-001',
        description: 'Red hydrant',
        categoryId: null,
        categoryName: 'Uncategorised',
      },
    });
  });

  it('offers invalid rows as ignore-only and never supplies a write target', () => {
    const review = buildMaterialPriceImportReview(
      [sourceRow(8, { nameText: ' ', unitCostText: '-1' })],
      [],
      categories,
    );

    expect(review.rows[0]).toMatchObject({
      classification: 'invalid',
      proposedAction: 'ignore',
      targetMaterialId: null,
      unitCost: null,
    });
    expect(review.rows[0].allowedActions).toEqual(['ignore']);
  });

  it.each([
    ['name', { nameText: 'N'.repeat(256) }],
    ['unit', { unitText: 'U'.repeat(33) }],
    ['supplier', { supplierText: 'S'.repeat(256) }],
    ['part number', { partNumberText: 'P'.repeat(256) }],
    ['description', { descriptionText: 'D'.repeat(2_001) }],
    ['category', { categoryText: 'C'.repeat(101) }],
  ])('classifies an overlong %s field as invalid before review', (_field, patch) => {
    const review = buildMaterialPriceImportReview(
      [sourceRow(8, patch)],
      [],
      categories,
    );
    expect(review.rows[0]).toMatchObject({
      classification: 'invalid',
      proposedAction: 'ignore',
    });
  });

  it('resolves an equivalent existing category without rewriting its display name', () => {
    const review = buildMaterialPriceImportReview(
      [sourceRow(9, {
        nameText: 'New valve',
        unitText: '',
        categoryText: '  ＶＡＬＶＥＳ ',
      })],
      [],
      categories,
    );

    expect(review.rows[0].createDraft).toMatchObject({
      unit: 'EA',
      categoryId: 20,
      categoryName: 'Valves',
    });
  });
});

describe('conflict-aware exact matching', () => {
  it('matches supplier plus part number inside the normalized supplier scope', () => {
    const review = buildMaterialPriceImportReview(
      [sourceRow(0, {
        nameText: 'Supplier wording',
        supplierText: '  ＣＯＲＥ & ＭＡＩＮ ',
        partNumberText: ' pv-100 ',
      })],
      [
        material(1, {
          name: 'Catalog A',
          supplier: 'Core & Main',
          partNumber: 'PV-100',
        }),
        material(2, {
          name: 'Catalog B',
          supplier: 'Ferguson',
          partNumber: 'PV-100',
        }),
      ],
      categories,
    );

    expect(review.rows[0]).toMatchObject({
      classification: 'matched',
      targetMaterialId: 1,
      candidateMaterialIds: [1],
    });
    expect(review.rows[0].matchReasons).toContain('supplier_part');
  });

  it('does not fall back to another supplier when supplier context is present', () => {
    const review = buildMaterialPriceImportReview(
      [sourceRow(0, {
        nameText: 'Supplier wording',
        supplierText: 'Supplier without this part',
        partNumberText: 'ONLY-1',
      })],
      [material(1, {
        name: 'Different catalog name',
        supplier: 'Other Supplier',
        partNumber: 'ONLY-1',
      })],
      categories,
    );

    expect(review.rows[0]).toMatchObject({
      classification: 'unmatched',
      targetMaterialId: null,
      candidateMaterialIds: [],
    });
  });

  it('uses an unscoped part number only when it is globally unique', () => {
    const unique = buildMaterialPriceImportReview(
      [sourceRow(0, {
        nameText: 'Supplier wording',
        supplierText: '',
        partNumberText: 'UNIQUE-1',
      })],
      [material(1, {
        name: 'Catalog item',
        supplier: 'One',
        partNumber: ' unique-1 ',
      })],
      categories,
    );
    const duplicate = buildMaterialPriceImportReview(
      [sourceRow(0, {
        nameText: 'Supplier wording',
        supplierText: '',
        partNumberText: 'SHARED-1',
      })],
      [
        material(1, { name: 'Catalog A', supplier: 'One', partNumber: 'SHARED-1' }),
        material(2, { name: 'Catalog B', supplier: 'Two', partNumber: 'shared-1' }),
      ],
      categories,
    );

    expect(unique.rows[0]).toMatchObject({
      classification: 'matched',
      targetMaterialId: 1,
      candidateMaterialIds: [1],
    });
    expect(unique.rows[0].matchReasons).toContain('unique_part');
    expect(duplicate.rows[0]).toMatchObject({
      classification: 'ambiguous',
      targetMaterialId: null,
      candidateMaterialIds: [1, 2],
    });
  });

  it('does not prefer name when unique name and part signals disagree', () => {
    const review = buildMaterialPriceImportReview(
      [sourceRow(0, {
        nameText: 'Catalog A',
        supplierText: 'Supplier A',
        partNumberText: 'PART-B',
      })],
      [
        material(1, { name: 'Catalog A', partNumber: 'PART-A' }),
        material(2, { name: 'Catalog B', partNumber: 'PART-B' }),
      ],
      categories,
    );

    expect(review.rows[0]).toMatchObject({
      classification: 'ambiguous',
      proposedAction: 'unresolved',
      targetMaterialId: null,
      candidateMaterialIds: [1, 2],
    });
    expect(review.rows[0].conflicts).toContain('name_part_disagreement');
  });

  it('keeps duplicate normalized catalogue names ambiguous', () => {
    const review = buildMaterialPriceImportReview(
      [sourceRow(0, {
        nameText: '  Storm Pipe ',
        supplierText: '',
        partNumberText: '',
      })],
      [
        material(1, { name: 'Storm Pipe', partNumber: null }),
        material(2, { name: 'ＳＴＯＲＭ　ＰＩＰＥ', partNumber: null }),
      ],
      categories,
    );

    expect(review.rows[0]).toMatchObject({
      classification: 'ambiguous',
      targetMaterialId: null,
      candidateMaterialIds: [1, 2],
    });
    expect(review.rows[0].conflicts).toContain('duplicate_candidate');
  });

  it('marks every row ambiguous when two source rows would update one target', () => {
    const review = buildMaterialPriceImportReview(
      [
        sourceRow(0, { nameText: 'Catalog A', partNumberText: '', unitCostText: '11' }),
        sourceRow(1, { nameText: ' catalog a ', partNumberText: '', unitCostText: '12' }),
      ],
      [material(1, { name: 'Catalog A' })],
      categories,
    );

    expect(review.rows.map(({ classification }) => classification))
      .toEqual(['ambiguous', 'ambiguous']);
    expect(review.rows.map(({ targetMaterialId }) => targetMaterialId))
      .toEqual([null, null]);
    for (const row of review.rows) {
      expect(row.candidateMaterialIds).toEqual([1]);
      expect(row.conflicts).toContain('duplicate_target');
    }
  });

  it('keeps indistinguishable proposed creations unresolved', () => {
    const review = buildMaterialPriceImportReview(
      [
        sourceRow(0, {
          nameText: 'New Coupling',
          supplierText: 'Supplier A',
          partNumberText: 'NC-1',
        }),
        sourceRow(1, {
          nameText: '  new coupling ',
          supplierText: ' supplier a ',
          partNumberText: ' nc-1 ',
        }),
      ],
      [],
      categories,
    );

    expect(review.rows.map(({ classification }) => classification))
      .toEqual(['ambiguous', 'ambiguous']);
    for (const row of review.rows) {
      expect(row.proposedAction).toBe('unresolved');
      expect(row.conflicts).toContain('duplicate_create');
    }
  });

  it('requires acknowledgement for a matched unit mismatch without converting it', () => {
    const mismatch = buildMaterialPriceImportReview(
      [sourceRow(0, {
        nameText: 'Catalog A',
        partNumberText: '',
        unitText: 'FT',
      })],
      [material(1, { name: 'Catalog A', unit: 'LF' })],
      categories,
    );
    const equivalent = buildMaterialPriceImportReview(
      [sourceRow(0, {
        nameText: 'Catalog A',
        partNumberText: '',
        unitText: ' lf ',
      })],
      [material(1, { name: 'Catalog A', unit: 'LF' })],
      categories,
    );

    expect(mismatch.rows[0]).toMatchObject({
      classification: 'ambiguous',
      proposedAction: 'unresolved',
      candidateMaterialIds: [1],
      targetMaterialId: 1,
      importedUnit: 'FT',
      existingUnit: 'LF',
      unitMismatch: true,
    });
    expect(mismatch.rows[0].conflicts).toContain('unit_mismatch');
    expect(equivalent.rows[0]).toMatchObject({
      classification: 'matched',
      targetMaterialId: 1,
      unitMismatch: false,
    });
  });
});

describe('unchanged and aggregate result contracts', () => {
  it('marks an unchanged price as no-write even when imported metadata differs', () => {
    const review = buildMaterialPriceImportReview(
      [sourceRow(0, {
        nameText: 'Catalog A',
        unitCostText: '10.00',
        supplierText: 'Replacement Supplier',
        partNumberText: '',
      })],
      [material(1, {
        name: 'Catalog A',
        defaultUnitCost: 10,
        supplier: 'Original Supplier',
        partNumber: 'ORIGINAL-1',
      })],
      categories,
    );

    expect(review.rows[0]).toMatchObject({
      classification: 'matched',
      targetMaterialId: 1,
      priceChanged: false,
      proposedUpdate: null,
    });
  });

  it('returns mutually exclusive aggregate-only result counts with the exact equation', () => {
    const outcomes: MaterialPriceImportOutcome[] = [
      { outcome: 'created', rowIndex: 0 },
      { outcome: 'created', rowIndex: 1 },
      { outcome: 'updated', rowIndex: 2 },
      { outcome: 'unchanged', rowIndex: 3 },
      { outcome: 'ignored', rowIndex: 4 },
      { outcome: 'invalid', rowIndex: 5 },
    ];
    const secretRowText = 'Supplier secret row description';
    (outcomes[0] as MaterialPriceImportOutcome & { rowText: string }).rowText = secretRowText;

    const result = summarizeMaterialPriceImportResults(outcomes);

    expect(result).toEqual({
      total: 6,
      created: 2,
      updated: 1,
      unchanged: 1,
      ignored: 1,
      invalid: 1,
    });
    expect(result.total).toBe(
      result.created + result.updated + result.unchanged + result.ignored + result.invalid,
    );
    expect(JSON.stringify(result)).not.toContain(secretRowText);
  });
});

describe('row-count and supported-host performance boundaries', () => {
  it('accepts exactly 10,000 rows and rejects 10,001 before review', () => {
    const atLimit = Array.from({ length: 10_000 }, (_, index) =>
      sourceRow(index, {
        nameText: `Unique imported ${index}`,
        supplierText: '',
        partNumberText: '',
        categoryText: '',
      }));
    const aboveLimit = [...atLimit, sourceRow(10_000)];

    expect(buildMaterialPriceImportReview(atLimit, [], categories).rows)
      .toHaveLength(10_000);
    expect(() => buildMaterialPriceImportReview(aboveLimit, [], categories))
      .toThrow(/10,?000|row|limit/i);
  });

  it('builds a usable 5,000-row exact-match review under five seconds repeatedly', () => {
    const existing = Array.from({ length: 5_000 }, (_, index) =>
      material(index + 1, {
        name: `Catalog material ${index}`,
        supplier: `Supplier ${index % 20}`,
        partNumber: `PART-${index}`,
      }));
    const imported = Array.from({ length: 5_000 }, (_, index) =>
      sourceRow(index, {
        nameText: ` catalog material ${index} `,
        supplierText: `Supplier ${index % 20}`,
        partNumberText: ` part-${index} `,
      }));
    const durations: number[] = [];

    for (let run = 0; run < 3; run++) {
      const started = performance.now();
      const review = buildMaterialPriceImportReview(imported, existing, categories);
      durations.push(performance.now() - started);
      expect(review.counts).toMatchObject({
        total: 5_000,
        matched: 5_000,
        ambiguous: 0,
        unmatched: 0,
        invalid: 0,
      });
    }

    expect(Math.max(...durations)).toBeLessThan(5_000);
  }, 30_000);
});
