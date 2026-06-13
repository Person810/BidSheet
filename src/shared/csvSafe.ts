/**
 * CSV formula-injection guard, shared by every CSV export path (QuickBooks,
 * unit-price, takeoff quantities, cost-code report).
 *
 * Spreadsheet apps treat a cell whose text begins with =, +, -, @, or a
 * leading tab/CR as a *formula* and evaluate it on open — so a user-controlled
 * value like `=HYPERLINK(...)` or `=cmd|...` becomes live code in Excel. The
 * UTF-8 BOM these exports add makes Excel even more eager to interpret cells.
 *
 * Neutralize by prefixing a single quote, which forces text mode. Genuine
 * numbers (including negatives like a -5.00 discount) are left untouched so
 * numeric columns still import as numbers — only non-numeric values that begin
 * with a dangerous character are quoted.
 */

/** A value that is purely a number (optionally signed / decimal / exponent). */
function isPlainNumber(s: string): boolean {
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s);
}

/** Prefix a leading apostrophe when a non-numeric cell could be read as a formula. */
export function neutralizeCsvFormula(value: string): string {
  if (value && /^[=+\-@\t\r]/.test(value) && !isPlainNumber(value)) {
    return "'" + value;
  }
  return value;
}
