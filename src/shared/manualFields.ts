/**
 * Sticky manual overrides on a bid line (§5, phase 2).
 *
 * Several line-item numbers are normally auto-derived from a catalog source:
 * material unit cost (from the material), labor hours (quantity ÷ production
 * rate), crew cost/hr (burdened crew), equipment cost/hr (equipment rate).
 * When the estimator types over one of these, that field is recorded here as
 * "manual" so a later change to its driver (e.g. quantity) no longer silently
 * recomputes — and the override can be surfaced and reverted. Picking a new
 * source for a field clears its override.
 *
 * Stored on bid_line_items.manual_fields as a JSON array of these keys.
 */

export const OVERRIDABLE_FIELDS = [
  'materialUnitCost',
  'laborHours',
  'laborCostPerHour',
  'equipmentCostPerHour',
] as const;

export type OverridableField = typeof OVERRIDABLE_FIELDS[number];

/** Short human labels for the overridable fields (tooltips, badges). */
export const MANUAL_FIELD_LABELS: Record<OverridableField, string> = {
  materialUnitCost: 'material unit cost',
  laborHours: 'labor hours',
  laborCostPerHour: 'crew cost/hr',
  equipmentCostPerHour: 'equipment cost/hr',
};

const VALID = new Set<string>(OVERRIDABLE_FIELDS);

/** Parse the stored JSON array into a clean, de-duped list of known fields. */
export function parseManualFields(raw: string | null | undefined): OverridableField[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return [...new Set(arr.filter((x): x is OverridableField => typeof x === 'string' && VALID.has(x)))];
  } catch {
    return [];
  }
}

/** Serialize for storage; null when empty so the column stays tidy. */
export function serializeManualFields(fields: readonly string[]): string | null {
  const clean = [...new Set(fields.filter((f) => VALID.has(f)))];
  return clean.length ? JSON.stringify(clean) : null;
}

export function isManual(fields: readonly string[], field: OverridableField): boolean {
  return fields.includes(field);
}

/** Add or remove a field's override flag, returning a new array. */
export function withManual(
  fields: readonly string[], field: OverridableField, on: boolean,
): OverridableField[] {
  const set = new Set<OverridableField>(fields.filter((f): f is OverridableField => VALID.has(f)));
  if (on) set.add(field); else set.delete(field);
  return [...set];
}
