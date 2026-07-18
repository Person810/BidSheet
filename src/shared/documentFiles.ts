/**
 * Per-job document store helpers.
 *
 * Documents attached to a job are copied into an app-managed folder
 * (userData/job-files/<job-id>/) rather than referenced by absolute path,
 * so a moved or renamed original never breaks the job. These helpers are
 * pure so the naming rules are testable outside Electron.
 */

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

/**
 * Windows-style collision handling for folder names within one parent:
 * "Plans" → "Plans - Copy" → "Plans - Copy (2)" → "Plans - Copy (3)"…
 * Comparison is case-insensitive so "plans" and "Plans" count as the
 * same name.
 */
export function uniqueSiblingFolderName(desired: string, siblings: Iterable<string>): string {
  const taken = new Set<string>();
  for (const name of siblings) taken.add(name.toLowerCase());
  if (!taken.has(desired.toLowerCase())) return desired;

  const copy = `${desired} - Copy`;
  if (!taken.has(copy.toLowerCase())) return copy;
  for (let n = 2; ; n++) {
    const candidate = `${copy} (${n})`;
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

// ---- Folder tree -----------------------------------------------------------

/** Minimal shape the tree helpers need; DB rows and DTOs both satisfy it. */
export interface FolderLike {
  id: number;
  parent_id: number | null;
  name: string;
  sort_order?: number;
}

export interface FolderNode {
  id: number;
  name: string;
  parentId: number | null;
  children: FolderNode[];
}

/**
 * Turns a flat folder list (as stored) into a tree for the sidebar. A folder
 * whose parent_id doesn't resolve within the list (dangling, or NULL) becomes
 * a root — so a job's folders always render even if one is mid-move.
 */
export function buildFolderTree(folders: FolderLike[]): FolderNode[] {
  const byId = new Map<number, FolderNode>();
  for (const f of folders) byId.set(f.id, { id: f.id, name: f.name, parentId: f.parent_id, children: [] });

  const ordered = [...folders].sort((a, b) =>
    (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)
  );

  const roots: FolderNode[] = [];
  for (const f of ordered) {
    const node = byId.get(f.id)!;
    const parent = f.parent_id != null ? byId.get(f.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/**
 * `id` plus every folder nested underneath it, however deep. Used to stop a
 * folder from being dropped into one of its own subfolders (which would
 * detach it from the tree entirely).
 */
export function descendantIds(folders: FolderLike[], id: number): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const f of folders) {
    if (f.parent_id != null) {
      if (!childrenOf.has(f.parent_id)) childrenOf.set(f.parent_id, []);
      childrenOf.get(f.parent_id)!.push(f.id);
    }
  }
  const out = new Set<number>([id]);
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const childId of childrenOf.get(current) ?? []) {
      if (!out.has(childId)) {
        out.add(childId);
        stack.push(childId);
      }
    }
  }
  return out;
}

/** Breadcrumb names from root to `id`, e.g. ["Plans", "Addenda"]. Root (null/missing) is []. */
export function folderPath(folders: FolderLike[], id: number | null): string[] {
  if (id == null) return [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: string[] = [];
  let current = byId.get(id);
  let guard = 0;
  while (current && guard++ < folders.length + 1) {
    path.unshift(current.name);
    current = current.parent_id != null ? byId.get(current.parent_id) : undefined;
  }
  return path;
}
