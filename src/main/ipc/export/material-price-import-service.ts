import path from 'node:path';
import type Database from 'better-sqlite3';
import type {
  MaterialPriceImportAction,
  MaterialPriceImportCommonAction as CommonAction,
  MaterialPriceImportCreateAction as CreateAction,
  MaterialPriceImportRequest,
  MaterialPriceImportResult,
  MaterialPriceImportUpdateAction as UpdateAction,
} from '../../../shared/types/ipc';

const MAX_ROWS = 10_000;
const MAX_SOURCE_LENGTH = 255;
const FIELD_LIMITS = {
  name: 255,
  unit: 32,
  supplier: 255,
  partNumber: 255,
  description: 2_000,
  categoryText: 100,
} as const;
const UNCATEGORISED = 'Uncategorised';

interface MaterialRecord {
  id: number;
  category_id: number;
  name: string;
  unit: string;
  default_unit_cost: number;
  supplier: string | null;
  part_number: string | null;
  is_active: number;
}

interface CategoryRecord {
  id: number;
  name: string;
}

interface ValidatedImport {
  source: string;
  rows: MaterialPriceImportAction[];
}

interface PlannedUpdate {
  action: UpdateAction;
  material: MaterialRecord;
}

class ImportValidationError extends Error {}

const COMMON_KEYS = new Set([
  'rowIndex',
  'name',
  'unitCost',
  'unit',
  'supplier',
  'partNumber',
  'description',
  'categoryText',
  'action',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rowError(rowIndex: number, message: string): ImportValidationError {
  return new ImportValidationError(`Import row ${rowIndex + 1}: ${message}`);
}

function comparisonKey(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('en-US');
}

function displayText(value: string): string {
  return value.trim();
}

function optionalText(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function expectString(
  row: Record<string, unknown>,
  field: keyof typeof FIELD_LIMITS,
  rowIndex: number,
): string {
  const value = row[field];
  if (typeof value !== 'string') {
    throw rowError(rowIndex, `${field} must be text.`);
  }
  if (value.length > FIELD_LIMITS[field]) {
    throw rowError(
      rowIndex,
      `${field} must be ${FIELD_LIMITS[field]} characters or fewer.`,
    );
  }
  return value;
}

function expectNullableString(
  row: Record<string, unknown>,
  field: 'supplier' | 'partNumber' | 'description' | 'categoryText',
  rowIndex: number,
): string | null {
  const value = row[field];
  if (value !== null && typeof value !== 'string') {
    throw rowError(rowIndex, `${field} must be text or null.`);
  }
  if (typeof value === 'string' && value.length > FIELD_LIMITS[field]) {
    throw rowError(
      rowIndex,
      `${field} must be ${FIELD_LIMITS[field]} characters or fewer.`,
    );
  }
  return value as string | null;
}

function assertExactKeys(
  row: Record<string, unknown>,
  allowedActionKeys: readonly string[],
  rowIndex: number,
): void {
  const allowed = new Set([...COMMON_KEYS, ...allowedActionKeys]);
  for (const key of Object.keys(row)) {
    if (!allowed.has(key)) {
      throw rowError(rowIndex, 'the requested action contains unsupported data.');
    }
  }
}

function validateCommon(
  row: Record<string, unknown>,
  seenIndexes: Set<number>,
): CommonAction {
  const rowIndex = row.rowIndex;
  if (!Number.isSafeInteger(rowIndex) || Number(rowIndex) < 0) {
    throw new ImportValidationError('Every import row needs a valid row number.');
  }
  const numericIndex = Number(rowIndex);
  if (seenIndexes.has(numericIndex)) {
    throw rowError(numericIndex, 'the row number is duplicated.');
  }
  seenIndexes.add(numericIndex);

  const name = expectString(row, 'name', numericIndex);
  const unit = expectString(row, 'unit', numericIndex);
  const supplier = expectNullableString(row, 'supplier', numericIndex);
  const partNumber = expectNullableString(row, 'partNumber', numericIndex);
  const description = expectNullableString(row, 'description', numericIndex);
  const categoryText = expectNullableString(row, 'categoryText', numericIndex);
  const unitCost = row.unitCost;
  if (unitCost !== null && (
    typeof unitCost !== 'number'
    || !Number.isFinite(unitCost)
    || unitCost < 0
  )) {
    throw rowError(numericIndex, 'unit cost must be a finite non-negative number.');
  }
  return {
    rowIndex: numericIndex,
    name,
    unitCost: unitCost as number | null,
    unit,
    supplier,
    partNumber,
    description,
    categoryText,
  };
}

function validateAction(
  value: unknown,
  seenIndexes: Set<number>,
): MaterialPriceImportAction {
  if (!isRecord(value)) {
    throw new ImportValidationError('Every import row must be an action object.');
  }
  const common = validateCommon(value, seenIndexes);
  if (value.action === 'update') {
    assertExactKeys(value, ['targetMaterialId', 'acknowledgeUnitMismatch'], common.rowIndex);
    if (!Number.isSafeInteger(value.targetMaterialId)
      || Number(value.targetMaterialId) <= 0) {
      throw rowError(common.rowIndex, 'choose a valid material.');
    }
    if (typeof value.acknowledgeUnitMismatch !== 'boolean') {
      throw rowError(common.rowIndex, 'unit acknowledgement must be true or false.');
    }
    if (!displayText(common.name) || !displayText(common.unit)
      || common.unitCost === null) {
      throw rowError(common.rowIndex, 'name, unit and unit cost are required.');
    }
    return {
      ...common,
      action: 'update',
      targetMaterialId: Number(value.targetMaterialId),
      acknowledgeUnitMismatch: value.acknowledgeUnitMismatch,
    };
  }
  if (value.action === 'create') {
    assertExactKeys(value, ['categoryId'], common.rowIndex);
    if (value.categoryId !== null && (
      !Number.isSafeInteger(value.categoryId)
      || Number(value.categoryId) <= 0
    )) {
      throw rowError(common.rowIndex, 'choose a valid category.');
    }
    if (!displayText(common.name) || !displayText(common.unit)
      || common.unitCost === null) {
      throw rowError(common.rowIndex, 'name, unit and unit cost are required.');
    }
    return {
      ...common,
      action: 'create',
      categoryId: value.categoryId === null ? null : Number(value.categoryId),
    };
  }
  if (value.action === 'ignore') {
    assertExactKeys(value, ['reason'], common.rowIndex);
    if (value.reason !== 'user' && value.reason !== 'invalid') {
      throw rowError(common.rowIndex, 'ignore reason must be user or invalid.');
    }
    const semanticallyInvalid =
      !displayText(common.name) || common.unitCost === null;
    if (
      (semanticallyInvalid && value.reason !== 'invalid')
      || (!semanticallyInvalid && value.reason !== 'user')
    ) {
      throw rowError(
        common.rowIndex,
        'the Ignore or Invalid classification changed; review this row.',
      );
    }
    return { ...common, action: 'ignore', reason: value.reason };
  }
  throw rowError(common.rowIndex, 'choose a supported import action.');
}

function sanitizedSource(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ImportValidationError('Import source must be a local file label.');
  }
  const trimmed = value.trim();
  const localLabel = path.basename(trimmed.replace(/\\/g, '/'));
  if (!localLabel || localLabel.length > MAX_SOURCE_LENGTH) {
    throw new ImportValidationError(
      'Import source must be between 1 and 255 characters.',
    );
  }
  if (/[\u0000-\u001f\u007f]/u.test(localLabel)) {
    throw new ImportValidationError('Import source contains unsupported characters.');
  }
  return localLabel;
}

function validateRequest(request: unknown): ValidatedImport {
  if (!isRecord(request)) {
    throw new ImportValidationError('Price import request is invalid.');
  }
  for (const key of Object.keys(request)) {
    if (key !== 'source' && key !== 'rows') {
      throw new ImportValidationError('Price import request contains unsupported data.');
    }
  }
  if (!Array.isArray(request.rows)) {
    throw new ImportValidationError('Price import rows must be a list.');
  }
  if (request.rows.length < 1 || request.rows.length > MAX_ROWS) {
    throw new ImportValidationError(
      'Price import must contain between 1 and 10,000 rows.',
    );
  }
  const seenIndexes = new Set<number>();
  return {
    source: sanitizedSource(request.source),
    rows: request.rows.map((row) => validateAction(row, seenIndexes)),
  };
}

function materialCandidates(
  materials: MaterialRecord[],
  action: CommonAction,
): Set<number> {
  const nameKey = comparisonKey(action.name);
  const supplierKey = comparisonKey(action.supplier);
  const partKey = comparisonKey(action.partNumber);
  const nameMatches = nameKey
    ? materials.filter((material) => comparisonKey(material.name) === nameKey)
    : [];
  let partMatches: MaterialRecord[] = [];
  if (partKey) {
    partMatches = materials.filter((material) =>
      comparisonKey(material.part_number) === partKey
      && (!supplierKey || comparisonKey(material.supplier) === supplierKey)
    );
  }
  return new Set([...nameMatches, ...partMatches].map(({ id }) => id));
}

function assertNoUpdateConflicts(
  action: UpdateAction,
  material: MaterialRecord,
  materials: MaterialRecord[],
): void {
  const candidates = materialCandidates(materials, action);
  if (candidates.size > 1
    || (candidates.size === 1 && !candidates.has(material.id))) {
      throw rowError(
        action.rowIndex,
        'the material match changed; review and choose the target again.',
    );
  }
  if (comparisonKey(action.unit) !== comparisonKey(material.unit)
    && !action.acknowledgeUnitMismatch) {
    throw rowError(
      action.rowIndex,
      'acknowledge the unit mismatch before updating the price.',
    );
  }
}

export function materialPriceImportCreateIdentityKeys(
  action: Pick<CommonAction, 'name' | 'supplier' | 'partNumber'>,
): string[] {
  const part = comparisonKey(action.partNumber);
  const supplier = comparisonKey(action.supplier);
  if (supplier && part) {
    return [`part:${supplier}:${part}`];
  }
  return [`name:${comparisonKey(action.name)}`];
}

function buildPlan(
  db: Database.Database,
  input: ValidatedImport,
): {
  categories: CategoryRecord[];
  creates: CreateAction[];
  updates: PlannedUpdate[];
  result: MaterialPriceImportResult;
} {
  const categories = db.prepare(
    'SELECT id, name FROM material_categories ORDER BY id',
  ).all() as CategoryRecord[];
  const allMaterials = db.prepare(
    `SELECT id, category_id, name, unit, default_unit_cost, supplier,
            part_number, is_active
     FROM materials ORDER BY id`,
  ).all() as MaterialRecord[];
  const byId = new Map(allMaterials.map((material) => [material.id, material]));
  const categoryIds = new Set(categories.map(({ id }) => id));
  const updateTargets = new Set<number>();
  const createKeys = new Set<string>();
  const creates: CreateAction[] = [];
  const updates: PlannedUpdate[] = [];
  const result: MaterialPriceImportResult = {
    total: input.rows.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    ignored: 0,
    invalid: 0,
  };

  for (const action of input.rows) {
    if (action.action === 'ignore') {
      if (action.reason === 'invalid') result.invalid++;
      else result.ignored++;
      continue;
    }
    if (action.action === 'update') {
      const target = byId.get(action.targetMaterialId);
      if (!target) {
        throw rowError(action.rowIndex, 'the selected material is no longer available.');
      }
      if (updateTargets.has(target.id)) {
        throw rowError(action.rowIndex, 'duplicate rows target the same material.');
      }
      updateTargets.add(target.id);
      assertNoUpdateConflicts(action, target, allMaterials);
      if (target.default_unit_cost === action.unitCost) {
        result.unchanged++;
      } else {
        updates.push({ action, material: target });
        result.updated++;
      }
      continue;
    }

    if (action.categoryId !== null && !categoryIds.has(action.categoryId)) {
      throw rowError(action.rowIndex, 'the selected category is no longer available.');
    }
    if (materialCandidates(allMaterials, action).size > 0) {
      throw rowError(
        action.rowIndex,
        'a matching catalogue material already exists; review this row.',
      );
    }
    for (const key of materialPriceImportCreateIdentityKeys(action)) {
      if (createKeys.has(key)) {
        throw rowError(
          action.rowIndex,
          'duplicate rows would create the same product.',
        );
      }
      createKeys.add(key);
    }
    creates.push(action);
    result.created++;
  }

  return { categories, creates, updates, result };
}

function safeCommitError(error: unknown): Error {
  if (error instanceof ImportValidationError) return error;
  return new Error(
    'Price import could not be saved. Nothing was changed. Try again.',
  );
}

export function commitMaterialPriceImport(
  db: Database.Database,
  request: MaterialPriceImportRequest | unknown,
): MaterialPriceImportResult {
  try {
    const input = validateRequest(request);
    const plan = buildPlan(db, input);
    const fallbackCategories = plan.categories.filter(
      ({ name }) => comparisonKey(name) === comparisonKey(UNCATEGORISED),
    );
    if (fallbackCategories.length > 1
      && plan.creates.some(({ categoryId }) => categoryId === null)) {
      throw new ImportValidationError(
        'More than one Uncategorised category exists. Review categories and try again.',
      );
    }

    const commit = db.transaction(() => {
      let fallbackCategoryId = fallbackCategories[0]?.id ?? null;
      if (fallbackCategoryId === null
        && plan.creates.some(({ categoryId }) => categoryId === null)) {
        fallbackCategoryId = Number(db.prepare(
          `INSERT INTO material_categories (name, description)
           VALUES (?, NULL)`,
        ).run(UNCATEGORISED).lastInsertRowid);
      }

      const insertMaterial = db.prepare(
        `INSERT INTO materials
           (category_id, name, description, unit, default_unit_cost,
            supplier, part_number)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertHistory = db.prepare(
        `INSERT INTO price_updates
           (material_id, old_price, new_price, source)
         VALUES (?, ?, ?, ?)`,
      );
      const created: Array<{ id: number; action: CreateAction }> = [];

      for (const action of plan.creates) {
        const categoryId = action.categoryId ?? fallbackCategoryId;
        if (categoryId === null) {
          throw new Error('Fallback category could not be resolved.');
        }
        const id = Number(insertMaterial.run(
          categoryId,
          displayText(action.name),
          optionalText(action.description),
          displayText(action.unit),
          action.unitCost,
          optionalText(action.supplier),
          optionalText(action.partNumber),
        ).lastInsertRowid);
        created.push({ id, action });
      }

      for (const { id, action } of created) {
        insertHistory.run(id, 0, action.unitCost, input.source);
      }
      for (const { action, material } of plan.updates) {
        insertHistory.run(
          material.id,
          material.default_unit_cost,
          action.unitCost,
          input.source,
        );
      }

      const updateMaterial = db.prepare(
        `UPDATE materials SET
           default_unit_cost = ?,
           last_price_update = datetime('now', 'localtime'),
           supplier = COALESCE(NULLIF(?, ''), supplier),
           part_number = COALESCE(NULLIF(?, ''), part_number),
           cost_per_cy = CASE
             WHEN tons_per_cy > 0 THEN round(? * tons_per_cy, 2)
             ELSE cost_per_cy
           END
         WHERE id = ?`,
      );
      for (const { action, material } of plan.updates) {
        updateMaterial.run(
          action.unitCost,
          optionalText(action.supplier) ?? '',
          optionalText(action.partNumber) ?? '',
          action.unitCost,
          material.id,
        );
      }
      return plan.result;
    });

    return commit();
  } catch (error) {
    throw safeCommitError(error);
  }
}
