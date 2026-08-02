/**
 * Equipment categories: the vocabulary behind the Category field on every
 * piece of equipment (#107).
 *
 * `equipment.category` is free text and stays that way — it is what a synced
 * equipment row carries to every other machine, and rewriting it into a
 * foreign key would make new rows unimportable on any client that predates
 * the change. The *managed list* is what this module is about: the names the
 * picker offers and the manager lets you add, rename, and delete.
 *
 * Stored in `app_settings.equipment_categories` the same way custom trades
 * are stored — one comma-separated string, so the separator is the one
 * character a name may never contain. Tri-state, like enabled_tools:
 *   null  → the user has never edited the list; use DEFAULT_EQUIPMENT_CATEGORIES
 *   ''    → they cleared it on purpose; the list is empty
 *   'a,b' → their list
 *
 * The list is never the whole truth on its own: equipment can carry a
 * category that isn't in it (rows synced from a machine with a different
 * list, or predating the manager). resolveEquipmentCategories unions the two
 * so an in-use category always appears, whatever the list says.
 */

/** The list every install starts with — the hardcoded set this replaces. */
export const DEFAULT_EQUIPMENT_CATEGORIES = [
  'Excavator', 'Backhoe', 'Loader', 'Compactor', 'Truck', 'Pump',
  'Crane', 'Trencher', 'Drill', 'Plow', 'Fusion', 'Survey',
  'Power', 'Transport', 'Other',
] as const;

/** Long enough for "Attachments & Small Tools", short enough to render as a chip. */
export const MAX_EQUIPMENT_CATEGORY_NAME = 40;

/** A guard against a runaway paste, not a judgement about anyone's fleet. */
export const MAX_EQUIPMENT_CATEGORIES = 60;

/** Trim, flatten whitespace, and cap the length. Returns '' for a non-name. */
export function cleanEquipmentCategoryName(name: string): string {
  return name
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFKC')
    .slice(0, MAX_EQUIPMENT_CATEGORY_NAME)
    .trim();
}

/** Case-insensitive identity, so "Excavator" and "excavator" are one category. */
export function equipmentCategoryKey(name: string): string {
  return cleanEquipmentCategoryName(name).toLocaleLowerCase('en-US');
}

/**
 * Read the stored column. Null (never edited) reads back as null so callers
 * can tell it apart from an empty list — see the tri-state above. Blanks,
 * case-insensitive duplicates, and overflow are dropped rather than shown
 * back to the user as junk rows.
 */
export function parseEquipmentCategories(value: string | null | undefined): string[] | null {
  if (value == null) return null;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of value.split(',')) {
    const name = cleanEquipmentCategoryName(part);
    const key = name.toLocaleLowerCase('en-US');
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
    if (result.length === MAX_EQUIPMENT_CATEGORIES) break;
  }
  return result;
}

/** The list to work with: the user's if they have one, the defaults if not. */
export function storedEquipmentCategories(value: string | null | undefined): string[] {
  return parseEquipmentCategories(value) ?? [...DEFAULT_EQUIPMENT_CATEGORIES];
}

/**
 * What to store. '' rather than null for an empty list — null means "never
 * edited" and would silently hand the defaults back to someone who just
 * deleted every category.
 */
export function serializeEquipmentCategories(list: string[]): string {
  // Clean each name *before* joining: a name that came in with a comma in it
  // is one category whose comma has to go, not two categories — joining first
  // would split it in half on the way back out.
  return (parseEquipmentCategories(list.map(cleanEquipmentCategoryName).join(',')) ?? []).join(',');
}

/**
 * Every category the UI should offer: the managed list plus any category
 * already in use on an equipment row, sorted case-insensitively. In-use names
 * are included whether or not the list knows about them, so a category can
 * never go missing from the picker while equipment still points at it.
 */
export function resolveEquipmentCategories(
  stored: string | null | undefined,
  inUse: string[] = []
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const name of [...storedEquipmentCategories(stored), ...inUse]) {
    const clean = cleanEquipmentCategoryName(name);
    const key = clean.toLocaleLowerCase('en-US');
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return sortEquipmentCategories(result);
}

/** Alphabetical, case-insensitive — the order the manager and picker show. */
export function sortEquipmentCategories(names: string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b, 'en-US', { sensitivity: 'base' }));
}

/** Validate a name for add/rename. Returns an error message, or null when it's fine. */
export function validateEquipmentCategoryName(
  name: string,
  existing: string[],
  /** The name being renamed, which is allowed to collide with itself. */
  excluding?: string
): string | null {
  const clean = cleanEquipmentCategoryName(name);
  if (!clean) return 'Category name is required.';
  if (name.includes(',')) return 'Category names cannot contain commas.';
  const key = clean.toLocaleLowerCase('en-US');
  const excludeKey = excluding ? equipmentCategoryKey(excluding) : null;
  let replacesExisting = false;
  for (const other of existing) {
    const otherKey = equipmentCategoryKey(other);
    if (otherKey === excludeKey) {
      replacesExisting = true;
      continue;
    }
    if (otherKey === key) return 'A category with this name already exists.';
  }
  // The cap is about how long the list gets. A rename swaps one name for
  // another and leaves the length alone, so it stays allowed at the cap.
  if (!replacesExisting && existing.length >= MAX_EQUIPMENT_CATEGORIES) {
    return `You can have at most ${MAX_EQUIPMENT_CATEGORIES} equipment categories.`;
  }
  return null;
}
