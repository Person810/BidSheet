/**
 * Custom trades: the free-text trades a user types at setup ("Directional
 * Drilling", "Demolition") for work BidSheet has no seed catalog for.
 *
 * They are deliberately kept out of `app_settings.trade_types`, which is a
 * controlled vocabulary of TradeType keys that drives catalog seeding and
 * module lookup — a typed name has neither. Custom trades live in their own
 * column and are purely descriptive; the tools a custom-trade user works with
 * come from the tool picker (see renderer/modules/registry.ts).
 *
 * Stored the same way as trade_types — one comma-separated string — so the
 * separator is the one character a name may never contain.
 */

/** Long enough for "Directional Drilling & Boring", short enough to render as a chip. */
export const MAX_CUSTOM_TRADE_NAME = 40;

/** A guard against a runaway paste, not a judgement about anyone's business. */
export const MAX_CUSTOM_TRADES = 8;

/** Trim, flatten whitespace, and cap the length. Returns '' for a non-name. */
export function cleanCustomTradeName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_CUSTOM_TRADE_NAME).trim();
}

/**
 * Read the stored column. Commas are the separator, so anything between them
 * is one name; blanks, duplicates (case-insensitively) and overflow are
 * dropped rather than shown back to the user as junk rows.
 */
export function parseCustomTrades(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of (value ?? '').split(',')) {
    const name = cleanCustomTradeName(part);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
    if (result.length === MAX_CUSTOM_TRADES) break;
  }
  return result;
}

/**
 * Add what the user typed. A comma-separated entry adds each name — pasting
 * "Boring, Demolition" is far more likely to mean two trades than one trade
 * with a comma in it, and a comma can't survive storage either way.
 */
export function addCustomTrades(existing: string[], input: string): string[] {
  return parseCustomTrades([...existing, input].join(','));
}

/** Drop one, matched the same way duplicates are. */
export function removeCustomTrade(existing: string[], name: string): string[] {
  const key = cleanCustomTradeName(name).toLowerCase();
  return existing.filter((t) => t.toLowerCase() !== key);
}

/** What to store. Null rather than '' when there are none, so the column reads as "no custom trades". */
export function serializeCustomTrades(list: string[]): string | null {
  const clean = parseCustomTrades(list.join(','));
  return clean.length > 0 ? clean.join(',') : null;
}
