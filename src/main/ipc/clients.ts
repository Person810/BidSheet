import type Database from 'better-sqlite3';
import { safeHandle, likeContains } from './shared';

/**
 * Resolve a client name to its row id, creating the record when it's new
 * (or reviving a soft-deleted one — typing a removed client's name on a job
 * means they're back). Name is the natural key, matched case-insensitively.
 * Returns null for a blank name.
 */
export function findOrCreateClient(db: Database.Database, rawName: unknown): number | null {
  const name = String(rawName ?? '').trim();
  if (!name) return null;
  const existing = db
    .prepare(
      `SELECT id, is_active FROM clients
       WHERE TRIM(name) = ? COLLATE NOCASE
       ORDER BY is_active DESC, id LIMIT 1`
    )
    .get(name) as any;
  if (existing) {
    if (existing.is_active !== 1) {
      db.prepare(
        "UPDATE clients SET is_active = 1, updated_at = datetime('now', 'localtime') WHERE id = ?"
      ).run(existing.id);
    }
    return existing.id;
  }
  return Number(db.prepare('INSERT INTO clients (name) VALUES (?)').run(name).lastInsertRowid);
}

export function registerClientHandlers(db: Database.Database): void {
  safeHandle('db:clients:list', (_event, includeInactive?: boolean) => {
    return db
      .prepare(
        `SELECT c.*,
          (SELECT COUNT(*) FROM jobs j WHERE j.client_id = c.id AND j.parent_job_id IS NULL) AS job_count
        FROM clients c
        ${includeInactive ? '' : 'WHERE c.is_active = 1'}
        ORDER BY c.name COLLATE NOCASE`
      )
      .all();
  });

  safeHandle('db:clients:get', (_event, id: number) => {
    return db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  });

  safeHandle('db:clients:search', (_event, query: string, limit?: number) => {
    const q = String(query ?? '').trim();
    const cap = Math.min(Math.max(limit ?? 20, 1), 50);
    if (!q) {
      return db
        .prepare('SELECT * FROM clients WHERE is_active = 1 ORDER BY name COLLATE NOCASE LIMIT ?')
        .all(cap);
    }
    const pattern = likeContains(q);
    return db
      .prepare(
        `SELECT * FROM clients
         WHERE is_active = 1
           AND (name LIKE ? ESCAPE '\\' COLLATE NOCASE
             OR contact_name LIKE ? ESCAPE '\\' COLLATE NOCASE
             OR contact_phone LIKE ? ESCAPE '\\' COLLATE NOCASE
             OR contact_email LIKE ? ESCAPE '\\' COLLATE NOCASE
             OR address LIKE ? ESCAPE '\\' COLLATE NOCASE)
         ORDER BY name COLLATE NOCASE
         LIMIT ?`
      )
      .all(pattern, pattern, pattern, pattern, pattern, cap);
  });

  // Upsert. With an id this is a plain update; without one it upserts by
  // name (find-or-create), which is what the job form uses — it never
  // tracks ids, just the typed name. A rename propagates to the
  // denormalized jobs.client of every linked job.
  safeHandle('db:clients:save', (_event, client: any) => {
    const name = String(client?.name ?? '').trim();
    if (!name) throw new Error('Client name is required.');

    const save = db.transaction(() => {
      const id: number | null = client.id ?? findOrCreateClient(db, name);
      if (client.id && !db.prepare('SELECT 1 FROM clients WHERE id = ?').get(client.id)) {
        throw new Error('That client no longer exists.');
      }
      db.prepare(
        `UPDATE clients SET
          name = ?, address = ?, contact_name = ?, contact_phone = ?,
          contact_email = ?, notes = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?`
      ).run(
        name,
        client.address ?? null,
        client.contactName ?? null,
        client.contactPhone ?? null,
        client.contactEmail ?? null,
        client.notes ?? null,
        id
      );
      db.prepare('UPDATE jobs SET client = ? WHERE client_id = ?').run(name, id);
      return { id };
    });
    return save();
  });

  // Soft delete, like the catalog tables: hard deletions don't propagate
  // through the merge-based cloud sync (another machine's push would just
  // resurrect the row), and linked jobs keep their history either way.
  safeHandle('db:clients:delete', (_event, id: number) => {
    return db.prepare('UPDATE clients SET is_active = 0 WHERE id = ?').run(id);
  });

  safeHandle('db:clients:restore', (_event, id: number) => {
    return db.prepare('UPDATE clients SET is_active = 1 WHERE id = ?').run(id);
  });
}
