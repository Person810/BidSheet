/**
 * Per-job document store helpers.
 *
 * Documents attached to a job are copied into an app-managed folder
 * (userData/job-files/<job-id>/) rather than referenced by absolute path,
 * so a moved or renamed original never breaks the job. These helpers are
 * pure so the naming rules are testable outside Electron.
 */

export const DOCUMENT_CATEGORIES = [
  'plans',
  'quotes',
  'specs',
  'photos',
  'contracts',
  'other',
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  plans: 'Plans',
  quotes: 'Quotes',
  specs: 'Specs',
  photos: 'Photos',
  contracts: 'Contracts',
  other: 'Other',
};

export function isDocumentCategory(value: unknown): value is DocumentCategory {
  return typeof value === 'string' && (DOCUMENT_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Turn an arbitrary original filename into a name that is safe to store
 * on Windows and Linux: path separators and reserved characters become
 * underscores, and the result is never empty or dot-only.
 */
export function sanitizeFilename(original: string): string {
  const base = original.replace(/^.*[\\/]/, ''); // strip any path fragments
  const cleaned = base
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /^\.+$/.test(cleaned)) return 'document';
  return cleaned;
}

/**
 * Pick a stored name that doesn't collide with names already in the job's
 * folder: "site plan.pdf" → "site plan (2).pdf" → "site plan (3).pdf"…
 * Comparison is case-insensitive because Windows filesystems are.
 */
export function uniqueStoredName(original: string, existing: Iterable<string>): string {
  const sanitized = sanitizeFilename(original);
  const taken = new Set<string>();
  for (const name of existing) taken.add(name.toLowerCase());
  if (!taken.has(sanitized.toLowerCase())) return sanitized;

  const dot = sanitized.lastIndexOf('.');
  const stem = dot > 0 ? sanitized.slice(0, dot) : sanitized;
  const ext = dot > 0 ? sanitized.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** "1.5 MB", "320 KB", "48 B" — for the Documents table's size column. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
