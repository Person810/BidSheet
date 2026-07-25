import { afterEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

import { initializeDatabase } from '../../database';
import { logger } from '../../logger';
import { commitMaterialPriceImport } from './material-price-import-service';

type CommonAction = {
  rowIndex: number;
  name: string;
  unitCost: number | null;
  unit: string;
  supplier: string | null;
  partNumber: string | null;
  description: string | null;
  categoryText: string | null;
};

type ImportAction =
  | (CommonAction & {
      action: 'update';
      targetMaterialId: number;
      acknowledgeUnitMismatch: boolean;
    })
  | (CommonAction & {
      action: 'create';
      categoryId: number | null;
    })
  | (CommonAction & {
      action: 'ignore';
      reason: 'user' | 'invalid';
    });

type ImportRequest = {
  source: string;
  rows: ImportAction[];
};

let openDatabases: Database.Database[] = [];

afterEach(() => {
  for (const db of openDatabases.splice(0)) db.close();
  vi.restoreAllMocks();
});

function freshDb(): Database.Database {
  const db = initializeDatabase(':memory:');
  openDatabases.push(db);
  return db;
}

function category(db: Database.Database, name = 'Pipe'): number {
  return Number(db.prepare(
    'INSERT INTO material_categories (name) VALUES (?)',
  ).run(name).lastInsertRowid);
}

function material(
  db: Database.Database,
  categoryId: number,
  values: {
    name?: string;
    unit?: string;
    price?: number;
    supplier?: string | null;
    partNumber?: string | null;
    description?: string | null;
  } = {},
): number {
  return Number(db.prepare(
    `INSERT INTO materials
       (category_id, name, description, unit, default_unit_cost, supplier, part_number)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    categoryId,
    values.name ?? 'Existing Pipe',
    values.description ?? 'Keep this description',
    values.unit ?? 'LF',
    values.price ?? 10,
    values.supplier ?? 'Old Supplier',
    values.partNumber ?? 'OLD-1',
  ).lastInsertRowid);
}

function base(rowIndex: number, changes: Partial<CommonAction> = {}): CommonAction {
  return {
    rowIndex,
    name: `Material ${rowIndex}`,
    unitCost: 12.5,
    unit: 'EA',
    supplier: null,
    partNumber: null,
    description: null,
    categoryText: null,
    ...changes,
  };
}

function create(
  rowIndex: number,
  changes: Partial<CommonAction & { categoryId: number | null }> = {},
): ImportAction {
  const { categoryId = null, ...fields } = changes;
  return { ...base(rowIndex, fields), action: 'create', categoryId };
}

function update(
  rowIndex: number,
  targetMaterialId: number,
  changes: Partial<CommonAction & { acknowledgeUnitMismatch: boolean }> = {},
): ImportAction {
  const { acknowledgeUnitMismatch = true, ...fields } = changes;
  return {
    ...base(rowIndex, fields),
    action: 'update',
    targetMaterialId,
    acknowledgeUnitMismatch,
  };
}

function ignore(rowIndex: number, reason: 'user' | 'invalid'): ImportAction {
  return {
    ...base(rowIndex, { unitCost: reason === 'invalid' ? null : 1 }),
    action: 'ignore',
    reason,
  };
}

function request(rows: ImportAction[], source = 'supplier-sheet.csv'): ImportRequest {
  return { source, rows };
}

function table(db: Database.Database, name: string): unknown[] {
  return db.prepare(`SELECT * FROM ${name} ORDER BY id`).all();
}

function catalogueState(db: Database.Database) {
  return {
    categories: table(db, 'material_categories'),
    materials: table(db, 'materials'),
    history: table(db, 'price_updates'),
  };
}

function expectSafeFailure(
  operation: () => unknown,
  forbidden: string[] = [],
): Error {
  let failure: unknown;
  try {
    operation();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  const error = failure as Error;
  expect(error.message).not.toMatch(/(?:SELECT|INSERT|UPDATE|DELETE)\s/i);
  expect(error.message).not.toMatch(/(?:sqlite|stack|at\s+\w+|[A-Z]:\\)/i);
  for (const secret of forbidden) expect(error.message).not.toContain(secret);
  return error;
}

describe('material price import successful atomic effects', () => {
  it('commits mixed create, update, unchanged and ignore decisions with exact counts', () => {
    const db = freshDb();
    const selectedCategory = category(db, 'Selected category');
    const existingId = material(db, selectedCategory);
    const unchangedId = material(db, selectedCategory, {
      name: 'Unchanged',
      price: 22,
      supplier: 'Keep Supplier',
      partNumber: 'KEEP-22',
    });

    const result = commitMaterialPriceImport(db, request([
      update(0, existingId, {
        name: 'Existing Pipe',
        unit: 'LF',
        unitCost: 15,
        supplier: 'New Supplier',
        partNumber: 'NEW-15',
      }),
      update(1, unchangedId, {
        name: 'Unchanged',
        unit: 'LF',
        unitCost: 22,
        supplier: '',
        partNumber: '',
      }),
      create(2, {
        name: 'Complete Created Material',
        unitCost: 7.25,
        unit: 'BOX',
        supplier: 'Fixture Supplier',
        partNumber: 'FS-725',
        description: 'Complete created description',
        categoryText: 'Selected category',
        categoryId: selectedCategory,
      }),
      create(3, {
        name: 'Fallback Material',
        unitCost: 0,
        unit: 'EA',
        categoryText: 'Unknown supplier category',
      }),
      ignore(4, 'user'),
      ignore(5, 'invalid'),
    ]));

    expect(result).toEqual({
      total: 6,
      created: 2,
      updated: 1,
      unchanged: 1,
      ignored: 1,
      invalid: 1,
    });
    expect(result.total).toBe(
      result.created + result.updated + result.unchanged
      + result.ignored + result.invalid,
    );

    expect(db.prepare('SELECT * FROM materials WHERE id = ?').get(existingId))
      .toMatchObject({
        id: existingId,
        category_id: selectedCategory,
        name: 'Existing Pipe',
        description: 'Keep this description',
        unit: 'LF',
        default_unit_cost: 15,
        supplier: 'New Supplier',
        part_number: 'NEW-15',
      });
    expect(db.prepare('SELECT * FROM materials WHERE id = ?').get(unchangedId))
      .toMatchObject({
        default_unit_cost: 22,
        supplier: 'Keep Supplier',
        part_number: 'KEEP-22',
      });
    expect(db.prepare(
      `SELECT m.*, c.name AS category_name
       FROM materials m JOIN material_categories c ON c.id = m.category_id
       WHERE m.name = ?`,
    ).get('Complete Created Material')).toMatchObject({
      category_name: 'Selected category',
      description: 'Complete created description',
      unit: 'BOX',
      default_unit_cost: 7.25,
      supplier: 'Fixture Supplier',
      part_number: 'FS-725',
      is_active: 1,
    });
    expect(db.prepare(
      `SELECT m.unit, m.default_unit_cost, c.name AS category_name
       FROM materials m JOIN material_categories c ON c.id = m.category_id
       WHERE m.name = 'Fallback Material'`,
    ).get()).toEqual({
      unit: 'EA',
      default_unit_cost: 0,
      category_name: 'Uncategorised',
    });

    const history = db.prepare(
      `SELECT m.name, p.old_price, p.new_price, p.source
       FROM price_updates p JOIN materials m ON m.id = p.material_id
       ORDER BY p.id`,
    ).all();
    expect(history).toEqual([
      {
        name: 'Complete Created Material',
        old_price: 0,
        new_price: 7.25,
        source: 'supplier-sheet.csv',
      },
      {
        name: 'Fallback Material',
        old_price: 0,
        new_price: 0,
        source: 'supplier-sheet.csv',
      },
      {
        name: 'Existing Pipe',
        old_price: 10,
        new_price: 15,
        source: 'supplier-sheet.csv',
      },
    ]);
  });

  it('reuses one normalized Uncategorised category and lazily creates it only when needed', () => {
    const reusedDb = freshDb();
    const fallbackId = category(reusedDb, '  UnCaTeGoRiSeD  ');
    commitMaterialPriceImport(reusedDb, request([
      create(0, { name: 'Uses fallback', categoryText: 'Not a category' }),
      create(1, { name: 'Also fallback', categoryText: null }),
    ]));
    expect(reusedDb.prepare(
      'SELECT id, name FROM material_categories',
    ).all()).toEqual([{ id: fallbackId, name: '  UnCaTeGoRiSeD  ' }]);
    expect(reusedDb.prepare(
      'SELECT DISTINCT category_id FROM materials',
    ).all()).toEqual([{ category_id: fallbackId }]);

    const noCreateDb = freshDb();
    const existingCategory = category(noCreateDb, 'Chosen');
    const existingMaterial = material(noCreateDb, existingCategory);
    commitMaterialPriceImport(noCreateDb, request([
      update(0, existingMaterial, {
        name: 'Existing Pipe',
        unit: 'LF',
        unitCost: 11,
      }),
      ignore(1, 'user'),
    ]));
    expect(noCreateDb.prepare(
      `SELECT COUNT(*) AS count FROM material_categories
       WHERE lower(trim(name)) = 'uncategorised'`,
    ).get()).toEqual({ count: 0 });
  });
});

describe('material price import privileged revalidation', () => {
  it.each([
    ['empty rows', { source: 'x.csv', rows: [] }],
    ['non-array rows', { source: 'x.csv', rows: {} }],
    ['source bound', { source: 's'.repeat(256), rows: [ignore(0, 'user')] }],
    ['negative row index', request([{ ...ignore(0, 'user'), rowIndex: -1 }])],
    ['duplicate row index', request([ignore(0, 'user'), ignore(0, 'invalid')])],
    ['negative price', request([create(0, { unitCost: -0.01 })])],
    ['missing create price', request([create(0, { unitCost: null })])],
    ['NaN price', request([create(0, { unitCost: Number.NaN })])],
    ['infinite price', request([create(0, { unitCost: Number.POSITIVE_INFINITY })])],
    ['blank create name', request([create(0, { name: '  ' })])],
    ['blank create unit', request([create(0, { unit: '  ' })])],
    ['oversized name', request([create(0, { name: 'N'.repeat(100_001) })])],
    ['oversized unit', request([create(0, { unit: 'U'.repeat(100_001) })])],
    ['oversized supplier', request([create(0, { supplier: 'S'.repeat(100_001) })])],
    ['oversized part number', request([create(0, { partNumber: 'P'.repeat(100_001) })])],
    ['oversized description', request([create(0, { description: 'D'.repeat(100_001) })])],
    ['forged action', request([{
      ...create(0),
      action: 'create',
      targetMaterialId: 1,
    } as unknown as ImportAction])],
  ])('rejects %s before any write', (_label, invalidRequest) => {
    const db = freshDb();
    const before = catalogueState(db);
    expectSafeFailure(() =>
      commitMaterialPriceImport(db, invalidRequest as ImportRequest));
    expect(catalogueState(db)).toEqual(before);
  });

  it('rejects a batch above 10,000 rows before creating its fallback category', () => {
    const db = freshDb();
    const rows = Array.from({ length: 10_001 }, (_, rowIndex) =>
      ignore(rowIndex, 'user'));
    expect(expectSafeFailure(() =>
      commitMaterialPriceImport(db, request(rows))).message)
      .toMatch(/10[,.]?000|row|limit/i);
    expect(catalogueState(db)).toEqual({
      categories: [],
      materials: [],
      history: [],
    });
  });

  it('rejects forged or stale material and category IDs atomically', () => {
    const db = freshDb();
    const categoryId = category(db);
    const materialId = material(db, categoryId);
    const before = catalogueState(db);

    for (const action of [
      update(0, 999_999),
      { ...update(0, materialId), targetMaterialId: -1 },
      create(0, { categoryId: 999_999 }),
      create(0, { categoryId: -1 }),
    ] as ImportAction[]) {
      const error = expectSafeFailure(() =>
        commitMaterialPriceImport(db, request([action])));
      expect(error.message).toMatch(/row|material|category|select|review/i);
      expect(catalogueState(db)).toEqual(before);
    }
  });

  it.each([
    [
      'a valid row labelled invalid',
      {
        ...base(0, {
          name: 'Valid ignored material',
          unitCost: 12.5,
          unit: 'EA',
        }),
        action: 'ignore',
        reason: 'invalid',
      } as ImportAction,
    ],
    [
      'an invalid row labelled as a user ignore',
      {
        ...base(0, {
          name: '  ',
          unitCost: null,
          unit: 'EA',
        }),
        action: 'ignore',
        reason: 'user',
      } as ImportAction,
    ],
  ])('rejects forged ignore classification for %s without writing', (_label, action) => {
    const db = freshDb();
    const categoryId = category(db);
    material(db, categoryId);
    const before = catalogueState(db);

    expect(expectSafeFailure(() =>
      commitMaterialPriceImport(db, request([action]))).message)
      .toMatch(/invalid|ignore|classification|review|row/i);
    expect(catalogueState(db)).toEqual(before);
  });

  it('rejects duplicate update targets and normalized duplicate creates', () => {
    const db = freshDb();
    const categoryId = category(db);
    const materialId = material(db, categoryId);
    const before = catalogueState(db);

    expect(expectSafeFailure(() => commitMaterialPriceImport(db, request([
      update(0, materialId, { name: 'Existing Pipe', unit: 'LF', unitCost: 11 }),
      update(1, materialId, { name: 'Existing Pipe', unit: 'LF', unitCost: 12 }),
    ]))).message).toMatch(/duplicate|same material|row/i);
    expect(catalogueState(db)).toEqual(before);

    expect(expectSafeFailure(() => commitMaterialPriceImport(db, request([
      create(0, {
        name: ' Café Valve ',
        supplier: 'SUPPLIER',
        partNumber: 'ABC-1',
      }),
      create(1, {
        name: 'Cafe\u0301 Valve',
        supplier: ' supplier ',
        partNumber: ' abc-1 ',
      }),
    ]))).message).toMatch(/duplicate|same product|row/i);
    expect(catalogueState(db)).toEqual(before);

    expect(expectSafeFailure(() => commitMaterialPriceImport(db, request([
      create(0, {
        name: ' existing pipe ',
        unit: 'LF',
        supplier: ' old supplier ',
        partNumber: ' old-1 ',
        categoryId,
      }),
    ]))).message).toMatch(/already|catalogue|duplicate|same product|row/i);
    expect(catalogueState(db)).toEqual(before);
  });

  it('requires unit-mismatch acknowledgement and preserves the catalogue unit', () => {
    const db = freshDb();
    const categoryId = category(db);
    const materialId = material(db, categoryId, { unit: 'LF' });
    const before = catalogueState(db);

    expect(expectSafeFailure(() => commitMaterialPriceImport(db, request([
      update(0, materialId, {
        name: 'Existing Pipe',
        unit: 'EA',
        unitCost: 11,
        acknowledgeUnitMismatch: false,
      }),
    ]))).message).toMatch(/unit|acknowledge|row/i);
    expect(catalogueState(db)).toEqual(before);

    const result = commitMaterialPriceImport(db, request([
      update(0, materialId, {
        name: 'Existing Pipe',
        unit: 'EA',
        unitCost: 11,
        acknowledgeUnitMismatch: true,
      }),
    ]));
    expect(result.updated).toBe(1);
    expect(db.prepare('SELECT unit FROM materials WHERE id = ?')
      .get(materialId)).toEqual({ unit: 'LF' });
  });
});

describe('material price import rollback and safe recovery', () => {
  const stages = [
    {
      name: 'category',
      trigger: `CREATE TRIGGER fail_import BEFORE INSERT ON material_categories
        WHEN NEW.name = 'Uncategorised'
        BEGIN SELECT RAISE(ABORT, 'forced category secret failure'); END`,
      rows: (materialId: number) => [
        update(0, materialId, { name: 'Existing Pipe', unit: 'LF', unitCost: 15 }),
        create(1, { name: 'Secret Category Product' }),
      ],
    },
    {
      name: 'material',
      trigger: `CREATE TRIGGER fail_import BEFORE INSERT ON materials
        BEGIN SELECT RAISE(ABORT, 'forced material secret failure'); END`,
      rows: (materialId: number) => [
        update(0, materialId, { name: 'Existing Pipe', unit: 'LF', unitCost: 15 }),
        create(1, { name: 'Secret Material Product' }),
      ],
    },
    {
      name: 'history',
      trigger: `CREATE TRIGGER fail_import BEFORE INSERT ON price_updates
        BEGIN SELECT RAISE(ABORT, 'forced history secret failure'); END`,
      rows: (materialId: number) => [
        create(0, { name: 'Secret History Product' }),
        update(1, materialId, { name: 'Existing Pipe', unit: 'LF', unitCost: 15 }),
      ],
    },
    {
      name: 'update',
      trigger: `CREATE TRIGGER fail_import BEFORE UPDATE ON materials
        BEGIN SELECT RAISE(ABORT, 'forced update secret failure'); END`,
      rows: (materialId: number) => [
        create(0, { name: 'Secret Update Product' }),
        update(1, materialId, { name: 'Existing Pipe', unit: 'LF', unitCost: 15 }),
      ],
    },
  ] as const;

  it.each(stages)(
    'rolls back a forced $name failure and retries without duplicate effects',
    ({ trigger, rows }) => {
      const db = freshDb();
      const categoryId = category(db);
      const materialId = material(db, categoryId);
      const before = catalogueState(db);
      const importRequest = request(rows(materialId), 'safe-local-label.csv');
      db.exec(trigger);

      const error = expectSafeFailure(
        () => commitMaterialPriceImport(db, importRequest),
        ['Secret', 'forced', 'Product'],
      );
      expect(error.message).toMatch(/import|save|try|row|catalogue/i);
      expect(catalogueState(db)).toEqual(before);

      db.exec('DROP TRIGGER fail_import');
      const result = commitMaterialPriceImport(db, importRequest);
      expect(result.created).toBe(1);
      expect(result.updated).toBe(1);
      expect(db.prepare(
        'SELECT COUNT(*) AS count FROM materials',
      ).get()).toEqual({ count: 2 });
      expect(db.prepare(
        'SELECT COUNT(*) AS count FROM price_updates',
      ).get()).toEqual({ count: 2 });
    },
  );

  it('keeps row contents and full paths out of thrown errors and logger output', () => {
    const db = freshDb();
    const secretSupplier = 'PRIVATE-SUPPLIER-CONTENT';
    const secretPart = 'PRIVATE-PART-991';
    const secretPath = 'C:\\private\\supplier\\prices.csv';
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const loggedError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    db.exec(`CREATE TRIGGER fail_import BEFORE INSERT ON materials
      BEGIN SELECT RAISE(ABORT, 'internal SQL supplier row failure'); END`);

    expectSafeFailure(() => commitMaterialPriceImport(db, request([
      create(27, {
        name: '=PRIVATE FORMULA-LIKE NAME',
        supplier: secretSupplier,
        partNumber: secretPart,
      }),
    ], secretPath)), [
      secretSupplier,
      secretPart,
      secretPath,
      '=PRIVATE FORMULA-LIKE NAME',
    ]);

    const logOutput = JSON.stringify([
      ...info.mock.calls,
      ...loggedError.mock.calls,
    ]);
    expect(logOutput).not.toContain(secretSupplier);
    expect(logOutput).not.toContain(secretPart);
    expect(logOutput).not.toContain(secretPath);
    expect(logOutput).not.toContain('=PRIVATE FORMULA-LIKE NAME');
  });
});
