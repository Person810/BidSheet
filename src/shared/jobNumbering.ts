/**
 * Auto-suggested sequential job numbers (#95).
 *
 * The format is a literal template where `YYYY`/`YY` become the current
 * year (full/short), `MM` the current month, and the longest run of `N`s
 * the zero-padded sequence counter (its length sets the padding):
 *
 *   "NNNN"        → 0001, 0002, …
 *   "JOB-NNNN"    → JOB-0001, JOB-0002, …
 *   "YYYY-NNN"    → 2026-001, 2026-002, … then 2027-001 in the new year
 *   "YY-NNN"      → 26-001, 26-002, …
 *   "YYYY-MM-NNN" → 2026-07-001, restarting the count each month
 *
 * Suggest, don't enforce: the next number is derived from the highest
 * existing number matching the format at creation time — never a stored
 * counter, which would drift across synced machines working offline. Two
 * offline devices can still mint the same number; the UI surfaces that as
 * a duplicate warning after sync rather than pretending to prevent it.
 * Because date tokens resolve before matching, year/month formats
 * naturally restart at the configured start each period (the old period's
 * numbers no longer match).
 */

interface ParsedFormat {
  prefix: string;
  /** Zero-pad width — the length of the N-run. */
  pad: number;
  suffix: string;
}

/**
 * Resolve the date tokens and locate the counter run. The counter is the
 * longest run of `N`s (ties go to the last), so literal N's in a short
 * prefix word ("NEWTON-NN") don't steal the slot. Null when the format has
 * no counter.
 */
export function parseJobNumberFormat(format: string, now: Date): ParsedFormat | null {
  const withYear = format
    .replace(/YYYY/g, String(now.getFullYear()))
    .replace(/YY/g, String(now.getFullYear() % 100).padStart(2, '0'))
    .replace(/MM/g, String(now.getMonth() + 1).padStart(2, '0'));
  let best: { index: number; length: number } | null = null;
  for (const m of withYear.matchAll(/N+/g)) {
    if (!best || m[0].length >= best.length) {
      best = { index: m.index!, length: m[0].length };
    }
  }
  if (!best) return null;
  return {
    prefix: withYear.slice(0, best.index),
    pad: best.length,
    suffix: withYear.slice(best.index + best.length),
  };
}

/**
 * The next number to suggest: max sequence among existing numbers that
 * match the format (same prefix/suffix, digits in the counter slot) plus
 * one, floored at `start`. Null when the format has no counter run.
 * Sequences longer than the padding are kept intact (1000 after 999 with
 * NNN padding).
 */
export function nextJobNumber(
  format: string,
  existingNumbers: Array<string | null | undefined>,
  start = 1,
  now: Date = new Date()
): string | null {
  const parsed = parseJobNumberFormat(format, now);
  if (!parsed) return null;
  const { prefix, pad, suffix } = parsed;

  let maxSeq = 0;
  for (const raw of existingNumbers) {
    if (!raw) continue;
    const s = String(raw).trim();
    if (s.length < prefix.length + suffix.length + 1) continue;
    if (!s.startsWith(prefix) || !s.endsWith(suffix)) continue;
    const counter = s.slice(prefix.length, s.length - suffix.length);
    if (!/^\d+$/.test(counter)) continue;
    const n = parseInt(counter, 10);
    if (n > maxSeq) maxSeq = n;
  }

  const seq = Math.max(maxSeq + 1, Math.max(1, Math.floor(start) || 1));
  return prefix + String(seq).padStart(pad, '0') + suffix;
}
