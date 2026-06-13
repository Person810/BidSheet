/**
 * App-wide display formatters. Kept in a neutral util (rather than a
 * feature-specific helpers module) so any page/component can import them
 * without reaching into the jobs feature.
 */

/** Format a number as USD currency, or "--" for null/undefined. */
export function formatCurrency(
  val: number | null | undefined,
  opts?: { maximumFractionDigits?: number },
): string {
  if (val == null) return '--';
  return (val ?? 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', ...opts });
}

/** Parse a YYYY-MM-DD date string and render it locally without timezone shift. */
export function formatDateLocal(dateStr: string): string {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return new Date(+match[1], +match[2] - 1, +match[3]).toLocaleDateString();
  }
  return new Date(dateStr).toLocaleDateString();
}

/**
 * Render a server timestamp (which may be a space-separated, tz-naive string)
 * as a local date + time. Treats a tz-naive value as UTC.
 */
export function formatDateTime(s: string): string {
  return new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')).toLocaleString();
}

/** Human-readable byte size (GB / MB / KB). */
export function formatBytes(n: number): string {
  if (n >= 1 << 30) return `${parseFloat((n / (1 << 30)).toFixed(2))} GB`;
  if (n >= 1 << 20) return `${parseFloat((n / (1 << 20)).toFixed(1))} MB`;
  return `${Math.ceil(n / 1024)} KB`;
}
