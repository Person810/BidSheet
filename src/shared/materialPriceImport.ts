export const MAX_MATERIAL_PRICE_IMPORT_ROWS = 10_000;
const MATERIAL_PRICE_IMPORT_FIELD_LIMITS = [
  ['nameText', 'Material name', 255],
  ['unitText', 'Unit', 32],
  ['supplierText', 'Supplier', 255],
  ['partNumberText', 'Part number', 255],
  ['descriptionText', 'Description', 2_000],
  ['categoryText', 'Category', 100],
] as const;

export interface MaterialPriceImportSourceRow {
  rowIndex: number;
  nameText: string;
  unitCostText: unknown;
  unitText?: string | null;
  supplierText?: string | null;
  partNumberText?: string | null;
  descriptionText?: string | null;
  categoryText?: string | null;
}

export interface ExistingMaterialForPriceImport {
  id: number;
  name: string;
  categoryId: number;
  categoryName: string;
  unit: string;
  defaultUnitCost: number;
  supplier: string | null;
  partNumber: string | null;
  description: string | null;
}

export interface MaterialCategoryForPriceImport {
  id: number;
  name: string;
}

export type MaterialPriceImportClassification =
  | 'matched'
  | 'ambiguous'
  | 'unmatched'
  | 'invalid';

export type MaterialPriceImportProposedAction =
  | 'update'
  | 'create'
  | 'match'
  | 'ignore'
  | 'unresolved';

export type MaterialPriceImportMatchReason =
  | 'name'
  | 'supplier_part'
  | 'unique_part';

export type MaterialPriceImportConflict =
  | 'duplicate_candidate'
  | 'name_part_disagreement'
  | 'duplicate_target'
  | 'duplicate_create'
  | 'unit_mismatch';

export interface MaterialPriceImportCreateDraft {
  name: string;
  unit: string;
  supplier: string | null;
  partNumber: string | null;
  description: string | null;
  categoryId: number | null;
  categoryName: string;
}

export interface ProposedMaterialPriceUpdate {
  targetMaterialId: number;
  newPrice: number;
  supplier: string | null;
  partNumber: string | null;
}

export interface MaterialPriceImportReviewRow {
  rowIndex: number;
  classification: MaterialPriceImportClassification;
  proposedAction: MaterialPriceImportProposedAction;
  allowedActions: MaterialPriceImportProposedAction[];
  candidateMaterialIds: number[];
  targetMaterialId: number | null;
  matchReasons: MaterialPriceImportMatchReason[];
  conflicts: MaterialPriceImportConflict[];
  unitCost: number | null;
  importedUnit: string;
  existingUnit: string | null;
  unitMismatch: boolean;
  priceChanged: boolean;
  proposedUpdate: ProposedMaterialPriceUpdate | null;
  createDraft: MaterialPriceImportCreateDraft;
  validationMessages: string[];
}

export interface MaterialPriceImportReviewCounts {
  total: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  invalid: number;
}

export interface MaterialPriceImportReview {
  rows: MaterialPriceImportReviewRow[];
  counts: MaterialPriceImportReviewCounts;
}

export type MaterialPriceImportOutcomeName =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'ignored'
  | 'invalid';

export interface MaterialPriceImportOutcome {
  outcome: MaterialPriceImportOutcomeName;
  rowIndex: number;
}

export interface MaterialPriceImportResultSummary {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  ignored: number;
  invalid: number;
}

interface CandidateIndexes {
  byName: Map<string, ExistingMaterialForPriceImport[]>;
  byPart: Map<string, ExistingMaterialForPriceImport[]>;
  bySupplierPart: Map<string, ExistingMaterialForPriceImport[]>;
}

/**
 * Comparison-only normalization. Display strings are retained separately.
 * NFKC makes harmless full-width supplier data comparable without stripping
 * accents or rewriting non-Latin text.
 */
export function materialPriceComparisonKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase();
}

/**
 * Parse a complete, non-negative decimal price. Currency symbols and correctly
 * grouped thousands separators remain compatible with the catalogue importer,
 * while partial numbers and spreadsheet-like expressions are rejected.
 */
export function parseMaterialPrice(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') return null;

  const text = value.trim();
  if (!text) return null;

  const completeDecimal =
    /^\$?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)$/u;
  if (!completeDecimal.test(text)) return null;

  const parsed = Number(text.replace(/[$,]/gu, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function displayText(value: unknown): string {
  return String(value ?? '').trim();
}

function optionalDisplayText(value: unknown): string | null {
  const displayed = displayText(value);
  return displayed ? displayed : null;
}

function addToIndex<T>(index: Map<string, T[]>, key: string, value: T): void {
  if (!key) return;
  const existing = index.get(key);
  if (existing) existing.push(value);
  else index.set(key, [value]);
}

function supplierPartKey(supplier: string, partNumber: string): string {
  return JSON.stringify([supplier, partNumber]);
}

function buildCandidateIndexes(
  materials: readonly ExistingMaterialForPriceImport[],
): CandidateIndexes {
  const indexes: CandidateIndexes = {
    byName: new Map(),
    byPart: new Map(),
    bySupplierPart: new Map(),
  };

  for (const candidate of materials) {
    const name = materialPriceComparisonKey(candidate.name);
    const supplier = materialPriceComparisonKey(candidate.supplier);
    const part = materialPriceComparisonKey(candidate.partNumber);
    addToIndex(indexes.byName, name, candidate);
    addToIndex(indexes.byPart, part, candidate);
    if (supplier && part) {
      addToIndex(
        indexes.bySupplierPart,
        supplierPartKey(supplier, part),
        candidate,
      );
    }
  }
  return indexes;
}

function uniqueCandidates(
  ...groups: readonly ExistingMaterialForPriceImport[][]
): ExistingMaterialForPriceImport[] {
  const byId = new Map<number, ExistingMaterialForPriceImport>();
  for (const group of groups) {
    for (const candidate of group) byId.set(candidate.id, candidate);
  }
  return [...byId.values()].sort((left, right) => left.id - right.id);
}

function categoryDraft(
  row: MaterialPriceImportSourceRow,
  categories: readonly MaterialCategoryForPriceImport[],
): Pick<MaterialPriceImportCreateDraft, 'categoryId' | 'categoryName'> {
  const categoryKey = materialPriceComparisonKey(row.categoryText);
  if (categoryKey) {
    const matches = categories.filter(
      (category) => materialPriceComparisonKey(category.name) === categoryKey,
    );
    if (matches.length === 1) {
      return { categoryId: matches[0].id, categoryName: matches[0].name };
    }
  }
  return { categoryId: null, categoryName: 'Uncategorised' };
}

function createDraft(
  row: MaterialPriceImportSourceRow,
  categories: readonly MaterialCategoryForPriceImport[],
): MaterialPriceImportCreateDraft {
  const unit = displayText(row.unitText);
  return {
    name: displayText(row.nameText),
    unit: unit || 'EA',
    supplier: optionalDisplayText(row.supplierText),
    partNumber: optionalDisplayText(row.partNumberText),
    description: optionalDisplayText(row.descriptionText),
    ...categoryDraft(row, categories),
  };
}

function sourcePartCandidates(
  row: MaterialPriceImportSourceRow,
  indexes: CandidateIndexes,
): {
  candidates: ExistingMaterialForPriceImport[];
  reason: MaterialPriceImportMatchReason | null;
} {
  const part = materialPriceComparisonKey(row.partNumberText);
  if (!part) return { candidates: [], reason: null };

  const supplier = materialPriceComparisonKey(row.supplierText);
  if (supplier) {
    return {
      candidates: indexes.bySupplierPart.get(
        supplierPartKey(supplier, part),
      ) ?? [],
      reason: 'supplier_part',
    };
  }
  return {
    candidates: indexes.byPart.get(part) ?? [],
    reason: 'unique_part',
  };
}

function invalidReviewRow(
  row: MaterialPriceImportSourceRow,
  categories: readonly MaterialCategoryForPriceImport[],
  unitCost: number | null,
  validationMessages: string[],
): MaterialPriceImportReviewRow {
  return {
    rowIndex: row.rowIndex,
    classification: 'invalid',
    proposedAction: 'ignore',
    allowedActions: ['ignore'],
    candidateMaterialIds: [],
    targetMaterialId: null,
    matchReasons: [],
    conflicts: [],
    unitCost,
    importedUnit: displayText(row.unitText),
    existingUnit: null,
    unitMismatch: false,
    priceChanged: false,
    proposedUpdate: null,
    createDraft: createDraft(row, categories),
    validationMessages,
  };
}

function classifySourceRow(
  row: MaterialPriceImportSourceRow,
  indexes: CandidateIndexes,
  categories: readonly MaterialCategoryForPriceImport[],
): MaterialPriceImportReviewRow {
  const unitCost = parseMaterialPrice(row.unitCostText);
  const validationMessages: string[] = [];
  if (!materialPriceComparisonKey(row.nameText)) {
    validationMessages.push('Material name is required.');
  }
  if (unitCost === null) {
    validationMessages.push('Unit cost must be a finite non-negative number.');
  }
  for (const [field, label, limit] of MATERIAL_PRICE_IMPORT_FIELD_LIMITS) {
    if (String(row[field] ?? '').length > limit) {
      validationMessages.push(`${label} must be ${limit} characters or fewer.`);
    }
  }
  if (validationMessages.length > 0) {
    return invalidReviewRow(row, categories, unitCost, validationMessages);
  }

  const nameCandidates =
    indexes.byName.get(materialPriceComparisonKey(row.nameText)) ?? [];
  const partSignal = sourcePartCandidates(row, indexes);
  const candidates = uniqueCandidates(nameCandidates, partSignal.candidates);
  const candidateMaterialIds = candidates.map(({ id }) => id);
  const matchReasons: MaterialPriceImportMatchReason[] = [];
  if (nameCandidates.length > 0) matchReasons.push('name');
  if (partSignal.candidates.length > 0 && partSignal.reason) {
    matchReasons.push(partSignal.reason);
  }

  const conflicts: MaterialPriceImportConflict[] = [];
  if (nameCandidates.length > 1 || partSignal.candidates.length > 1) {
    conflicts.push('duplicate_candidate');
  }

  const uniqueName = nameCandidates.length === 1 ? nameCandidates[0] : null;
  const uniquePart =
    partSignal.candidates.length === 1 ? partSignal.candidates[0] : null;
  if (uniqueName && uniquePart && uniqueName.id !== uniquePart.id) {
    conflicts.push('name_part_disagreement');
  }

  let target: ExistingMaterialForPriceImport | null = null;
  if (conflicts.length === 0) target = uniqueName ?? uniquePart;

  const importedUnit = displayText(row.unitText);
  const unitMismatch = Boolean(
    target
    && materialPriceComparisonKey(importedUnit)
    && materialPriceComparisonKey(target.unit)
    && materialPriceComparisonKey(importedUnit)
      !== materialPriceComparisonKey(target.unit),
  );
  if (unitMismatch) conflicts.push('unit_mismatch');

  const classification: MaterialPriceImportClassification =
    conflicts.length > 0
      ? 'ambiguous'
      : target
        ? 'matched'
        : 'unmatched';
  const priceChanged = Boolean(
    target && unitCost !== null && target.defaultUnitCost !== unitCost,
  );
  const proposedUpdate =
    classification === 'matched' && target && priceChanged
      ? {
          targetMaterialId: target.id,
          newPrice: unitCost!,
          supplier: optionalDisplayText(row.supplierText),
          partNumber: optionalDisplayText(row.partNumberText),
        }
      : null;

  return {
    rowIndex: row.rowIndex,
    classification,
    proposedAction: classification === 'matched' ? 'update' : 'unresolved',
    allowedActions: classification === 'matched'
      ? ['update', 'ignore']
      : ['create', 'match', 'ignore'],
    candidateMaterialIds,
    targetMaterialId: target?.id ?? null,
    matchReasons,
    conflicts,
    unitCost,
    importedUnit,
    existingUnit: target?.unit ?? null,
    unitMismatch,
    priceChanged,
    proposedUpdate,
    createDraft: createDraft(row, categories),
    validationMessages,
  };
}

function addConflict(
  row: MaterialPriceImportReviewRow,
  conflict: MaterialPriceImportConflict,
  clearTarget: boolean,
): void {
  if (!row.conflicts.includes(conflict)) row.conflicts.push(conflict);
  row.classification = 'ambiguous';
  row.proposedAction = 'unresolved';
  row.allowedActions = ['create', 'match', 'ignore'];
  row.proposedUpdate = null;
  if (clearTarget) row.targetMaterialId = null;
}

function markDuplicateTargets(rows: MaterialPriceImportReviewRow[]): void {
  const rowsByTarget = new Map<number, MaterialPriceImportReviewRow[]>();
  for (const row of rows) {
    if (row.classification === 'invalid') continue;
    if (row.candidateMaterialIds.length !== 1) continue;
    const target = row.candidateMaterialIds[0];
    const group = rowsByTarget.get(target);
    if (group) group.push(row);
    else rowsByTarget.set(target, [row]);
  }

  for (const group of rowsByTarget.values()) {
    if (group.length < 2) continue;
    for (const row of group) addConflict(row, 'duplicate_target', true);
  }
}

function proposedCreateIdentity(row: MaterialPriceImportReviewRow): string {
  const supplier = materialPriceComparisonKey(row.createDraft.supplier);
  const part = materialPriceComparisonKey(row.createDraft.partNumber);
  if (supplier && part) return JSON.stringify(['supplier_part', supplier, part]);
  return JSON.stringify(['name', materialPriceComparisonKey(row.createDraft.name)]);
}

function markDuplicateCreates(rows: MaterialPriceImportReviewRow[]): void {
  const rowsByIdentity = new Map<string, MaterialPriceImportReviewRow[]>();
  for (const row of rows) {
    if (row.classification !== 'unmatched') continue;
    const identity = proposedCreateIdentity(row);
    const group = rowsByIdentity.get(identity);
    if (group) group.push(row);
    else rowsByIdentity.set(identity, [row]);
  }

  for (const group of rowsByIdentity.values()) {
    if (group.length < 2) continue;
    for (const row of group) addConflict(row, 'duplicate_create', false);
  }
}

function reviewCounts(
  rows: readonly MaterialPriceImportReviewRow[],
): MaterialPriceImportReviewCounts {
  return {
    total: rows.length,
    matched: rows.filter(({ classification }) => classification === 'matched').length,
    ambiguous: rows.filter(
      ({ classification }) => classification === 'ambiguous',
    ).length,
    unmatched: rows.filter(
      ({ classification }) => classification === 'unmatched',
    ).length,
    invalid: rows.filter(({ classification }) => classification === 'invalid').length,
  };
}

export function buildMaterialPriceImportReview(
  sourceRows: readonly MaterialPriceImportSourceRow[],
  materials: readonly ExistingMaterialForPriceImport[],
  categories: readonly MaterialCategoryForPriceImport[],
): MaterialPriceImportReview {
  if (
    sourceRows.length < 1
    || sourceRows.length > MAX_MATERIAL_PRICE_IMPORT_ROWS
  ) {
    throw new Error(
      `Material price import must contain between 1 and ${MAX_MATERIAL_PRICE_IMPORT_ROWS.toLocaleString('en-US')} rows.`,
    );
  }

  const rowIndexes = new Set<number>();
  for (const row of sourceRows) {
    if (
      !Number.isSafeInteger(row.rowIndex)
      || row.rowIndex < 0
      || rowIndexes.has(row.rowIndex)
    ) {
      throw new Error('Material price import row indexes must be unique non-negative integers.');
    }
    rowIndexes.add(row.rowIndex);
  }

  const indexes = buildCandidateIndexes(materials);
  const rows = sourceRows.map(
    (row) => classifySourceRow(row, indexes, categories),
  );
  markDuplicateTargets(rows);
  markDuplicateCreates(rows);

  return { rows, counts: reviewCounts(rows) };
}

export function summarizeMaterialPriceImportResults(
  outcomes: readonly MaterialPriceImportOutcome[],
): MaterialPriceImportResultSummary {
  const result: MaterialPriceImportResultSummary = {
    total: outcomes.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    ignored: 0,
    invalid: 0,
  };

  for (const item of outcomes) {
    switch (item.outcome) {
      case 'created':
        result.created++;
        break;
      case 'updated':
        result.updated++;
        break;
      case 'unchanged':
        result.unchanged++;
        break;
      case 'ignored':
        result.ignored++;
        break;
      case 'invalid':
        result.invalid++;
        break;
      default:
        throw new Error('Unknown material price import outcome.');
    }
  }
  return result;
}
