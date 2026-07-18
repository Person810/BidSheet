import { describe, it, expect, vi } from 'vitest';
import type Database from 'better-sqlite3';

// database.ts imports electron only for getDbPath(); this suite always
// runs migrations against a bare in-memory DB it drives itself, so the
// mock only needs to exist, not do anything.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

import BetterSqlite3 from 'better-sqlite3';
import { MIGRATIONS } from './database';

/** Runs migrations 1..version (1-indexed, matching schema_version) against a fresh DB. */
function dbAtVersion(version: number): Database.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
  for (let v = 1; v <= version; v++) {
    db.transaction(() => MIGRATIONS[v - 1](db))();
  }
  return db;
}

function insertJob(db: Database.Database, name: string): number {
  return Number(db.prepare("INSERT INTO jobs (name, client) VALUES (?, 'C')").run(name).lastInsertRowid);
}

function insertDoc(db: Database.Database, jobId: number, filename: string, category: string) {
  db.prepare(
    `INSERT INTO job_documents (job_id, filename, stored_name, category, size_bytes, sha256)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run(jobId, filename, filename, category, `sha-${filename}`);
}

describe('migration v41 — document folders', () => {
  it('adds job_document_folders and job_documents.folder_id', () => {
    const db = dbAtVersion(41);
    const folderCols = (db.prepare('PRAGMA table_info(job_document_folders)').all() as any[]).map((c) => c.name);
    expect(folderCols).toEqual(
      expect.arrayContaining(['id', 'job_id', 'parent_id', 'name', 'sort_order', 'uuid', 'created_at'])
    );
    const docCols = (db.prepare('PRAGMA table_info(job_documents)').all() as any[]).map((c) => c.name);
    expect(docCols).toContain('folder_id');
  });

  it('backfills one same-named root folder per category actually in use, leaving "other" unfiled', () => {
    const db = dbAtVersion(40);
    const jobId = insertJob(db, 'J');
    insertDoc(db, jobId, 'plan.pdf', 'plans');
    insertDoc(db, jobId, 'quote.pdf', 'quotes');
    insertDoc(db, jobId, 'photo.jpg', 'photos');
    insertDoc(db, jobId, 'misc.txt', 'other');

    db.transaction(() => MIGRATIONS[40](db))(); // migrateV41

    const folders = db.prepare('SELECT * FROM job_document_folders WHERE job_id = ?').all(jobId) as any[];
    expect(folders.map((f) => f.name).sort()).toEqual(['Photos', 'Plans', 'Quotes']);
    expect(folders.every((f) => f.parent_id === null)).toBe(true);

    const docs = db.prepare('SELECT filename, folder_id FROM job_documents WHERE job_id = ?').all(jobId) as any[];
    const byFile = new Map(docs.map((d) => [d.filename, d.folder_id]));
    const folderIdByName = new Map(folders.map((f) => [f.name, f.id]));
    expect(byFile.get('plan.pdf')).toBe(folderIdByName.get('Plans'));
    expect(byFile.get('quote.pdf')).toBe(folderIdByName.get('Quotes'));
    expect(byFile.get('photo.jpg')).toBe(folderIdByName.get('Photos'));
    expect(byFile.get('misc.txt')).toBeNull();
  });

  it('creates no folders for a job whose documents are all "other"', () => {
    const db = dbAtVersion(40);
    const jobId = insertJob(db, 'J2');
    insertDoc(db, jobId, 'x.txt', 'other');

    db.transaction(() => MIGRATIONS[40](db))();

    expect(db.prepare('SELECT * FROM job_document_folders WHERE job_id = ?').all(jobId)).toEqual([]);
  });

  it('keeps each job\'s backfilled folders separate', () => {
    const db = dbAtVersion(40);
    const jobA = insertJob(db, 'A');
    const jobB = insertJob(db, 'B');
    insertDoc(db, jobA, 'a-plan.pdf', 'plans');
    insertDoc(db, jobB, 'b-quote.pdf', 'quotes');

    db.transaction(() => MIGRATIONS[40](db))();

    const foldersA = db.prepare('SELECT name FROM job_document_folders WHERE job_id = ?').all(jobA) as any[];
    const foldersB = db.prepare('SELECT name FROM job_document_folders WHERE job_id = ?').all(jobB) as any[];
    expect(foldersA.map((f) => f.name)).toEqual(['Plans']);
    expect(foldersB.map((f) => f.name)).toEqual(['Quotes']);
  });
});

describe('migration v44 — client records backfill', () => {
  const insertClientJob = (db: Database.Database, client: string, updatedAt: string): number =>
    Number(
      db
        .prepare("INSERT INTO jobs (name, client, updated_at) VALUES ('J', ?, ?)")
        .run(client, updatedAt).lastInsertRowid
    );

  it('creates one client per distinct name (case-insensitive) and links the jobs', () => {
    const db = dbAtVersion(43);
    const older = insertClientJob(db, 'smith construction', '2026-01-01 00:00:00');
    const newer = insertClientJob(db, 'Smith Construction', '2026-02-01 00:00:00');
    const jones = insertClientJob(db, 'Jones Paving', '2026-01-15 00:00:00');
    const blank = insertClientJob(db, '   ', '2026-01-16 00:00:00');

    db.transaction(() => MIGRATIONS[43](db))();

    const clients = db.prepare('SELECT * FROM clients ORDER BY id').all() as any[];
    expect(clients).toHaveLength(2);
    // Display name comes from the most recently updated job in the group
    expect(clients.map((c) => c.name).sort()).toEqual(['Jones Paving', 'Smith Construction']);
    for (const c of clients) expect(c.uuid).toMatch(/^[0-9a-f-]{36}$/);

    const clientIdOf = (jobId: number) =>
      (db.prepare('SELECT client_id FROM jobs WHERE id = ?').get(jobId) as any).client_id;
    expect(clientIdOf(older)).toBe(clientIdOf(newer));
    expect(clientIdOf(jones)).not.toBe(clientIdOf(newer));
    expect(clientIdOf(blank)).toBeNull();
  });
});
