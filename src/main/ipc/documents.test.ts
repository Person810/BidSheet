import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';

/**
 * Folder CRUD lives behind ipcMain.handle, so this fakes just enough of
 * 'electron' to capture registered handlers and invoke them directly —
 * database.ts only needs app.getPath (unused here since tests always pass
 * ':memory:'), and documents.ts needs dialog/shell for the file-picker
 * paths this suite doesn't exercise.
 */
const handlers = new Map<string, (event: any, ...args: any[]) => any>();

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  ipcMain: { handle: (channel: string, fn: any) => handlers.set(channel, fn) },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
}));

import { initializeDatabase } from '../database';
import { registerDocumentHandlers } from './documents';

function call(channel: string, ...args: any[]) {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return fn(null, ...args);
}

describe('document folders', () => {
  let db: Database.Database;
  let jobId: number;

  beforeEach(() => {
    handlers.clear();
    db = initializeDatabase(':memory:');
    registerDocumentHandlers(db);
    jobId = Number(db.prepare("INSERT INTO jobs (name, client) VALUES ('J', 'C')").run().lastInsertRowid);
  });

  it('creates a root folder and lists it', async () => {
    const { id } = await call('db:document-folders:create', jobId, null, 'Plans');
    const list = await call('db:document-folders:list', jobId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, job_id: jobId, parent_id: null, name: 'Plans' });
  });

  it('creates nested subfolders', async () => {
    const { id: parentId } = await call('db:document-folders:create', jobId, null, 'Plans');
    const { id: childId } = await call('db:document-folders:create', jobId, parentId, 'Addenda');
    const list = await call('db:document-folders:list', jobId);
    expect(list.find((f: any) => f.id === childId).parent_id).toBe(parentId);
  });

  it('rejects an empty or blank folder name', async () => {
    await expect(call('db:document-folders:create', jobId, null, '   ')).rejects.toThrow(/empty/i);
  });

  it('rejects a parent folder that belongs to a different job', async () => {
    const otherJobId = Number(db.prepare("INSERT INTO jobs (name, client) VALUES ('J2', 'C')").run().lastInsertRowid);
    const { id: parentId } = await call('db:document-folders:create', jobId, null, 'Plans');
    await expect(call('db:document-folders:create', otherJobId, parentId, 'Addenda'))
      .rejects.toThrow(/parent folder not found/i);
  });

  it('renames a folder', async () => {
    const { id } = await call('db:document-folders:create', jobId, null, 'Plans');
    await call('db:document-folders:rename', id, 'Site Plans');
    const list = await call('db:document-folders:list', jobId);
    expect(list[0].name).toBe('Site Plans');
  });

  it('suffixes " - Copy" when creating a duplicate sibling name', async () => {
    await call('db:document-folders:create', jobId, null, 'Plans');
    const { id: second } = await call('db:document-folders:create', jobId, null, 'Plans');
    const { id: third } = await call('db:document-folders:create', jobId, null, 'plans');
    const list = await call('db:document-folders:list', jobId);
    expect(list.find((f: any) => f.id === second).name).toBe('Plans - Copy');
    expect(list.find((f: any) => f.id === third).name).toBe('plans - Copy (2)');
  });

  it('allows the same name under different parents', async () => {
    const { id: parentId } = await call('db:document-folders:create', jobId, null, 'Plans');
    const { id: nested } = await call('db:document-folders:create', jobId, parentId, 'Plans');
    const list = await call('db:document-folders:list', jobId);
    expect(list.find((f: any) => f.id === nested).name).toBe('Plans');
  });

  it('refuses to rename a folder onto a sibling\'s name', async () => {
    await call('db:document-folders:create', jobId, null, 'Plans');
    const { id } = await call('db:document-folders:create', jobId, null, 'Photos');
    await expect(call('db:document-folders:rename', id, 'plans')).rejects.toThrow(/already exists/i);
  });

  it('lets a rename keep or re-case the folder\'s own name', async () => {
    const { id } = await call('db:document-folders:create', jobId, null, 'plans');
    await call('db:document-folders:rename', id, 'Plans');
    const list = await call('db:document-folders:list', jobId);
    expect(list.find((f: any) => f.id === id).name).toBe('Plans');
  });

  it('suffixes " - Copy" when a move lands next to a same-named sibling', async () => {
    const { id: parentId } = await call('db:document-folders:create', jobId, null, 'A');
    const { id: movedId } = await call('db:document-folders:create', jobId, parentId, 'Plans');
    await call('db:document-folders:create', jobId, null, 'Plans');
    await call('db:document-folders:move', movedId, null);
    const list = await call('db:document-folders:list', jobId);
    expect(list.find((f: any) => f.id === movedId)).toMatchObject({ parent_id: null, name: 'Plans - Copy' });
  });

  it('moves a folder to a new parent', async () => {
    const { id: a } = await call('db:document-folders:create', jobId, null, 'A');
    const { id: b } = await call('db:document-folders:create', jobId, null, 'B');
    await call('db:document-folders:move', a, b);
    const list = await call('db:document-folders:list', jobId);
    expect(list.find((f: any) => f.id === a).parent_id).toBe(b);
  });

  it('refuses to move a folder into itself', async () => {
    const { id: a } = await call('db:document-folders:create', jobId, null, 'A');
    await expect(call('db:document-folders:move', a, a)).rejects.toThrow(/into itself/i);
  });

  it('refuses to move a folder into its own subfolder', async () => {
    const { id: a } = await call('db:document-folders:create', jobId, null, 'A');
    const { id: b } = await call('db:document-folders:create', jobId, a, 'B');
    await expect(call('db:document-folders:move', a, b)).rejects.toThrow(/own subfolder/i);
  });

  it('deletes an empty folder', async () => {
    const { id } = await call('db:document-folders:create', jobId, null, 'Empty');
    await call('db:document-folders:delete', id);
    expect(await call('db:document-folders:list', jobId)).toHaveLength(0);
  });

  it('refuses to delete a folder that still has a subfolder', async () => {
    const { id: a } = await call('db:document-folders:create', jobId, null, 'A');
    await call('db:document-folders:create', jobId, a, 'B');
    await expect(call('db:document-folders:delete', a)).rejects.toThrow(/not empty/i);
  });

  it('refuses to delete a folder that still has a document', async () => {
    const { id } = await call('db:document-folders:create', jobId, null, 'Plans');
    db.prepare(
      `INSERT INTO job_documents (job_id, filename, stored_name, category, size_bytes, sha256, folder_id)
       VALUES (?, 'a.pdf', 'a.pdf', 'other', 0, 'h', ?)`
    ).run(jobId, id);
    await expect(call('db:document-folders:delete', id)).rejects.toThrow(/not empty/i);
  });

  it('moves a document between folders and back to root', async () => {
    const { id: folderId } = await call('db:document-folders:create', jobId, null, 'Plans');
    const docId = Number(db.prepare(
      `INSERT INTO job_documents (job_id, filename, stored_name, category, size_bytes, sha256)
       VALUES (?, 'a.pdf', 'a.pdf', 'other', 0, 'h')`
    ).run(jobId).lastInsertRowid);

    await call('db:documents:move', docId, folderId);
    expect((db.prepare('SELECT folder_id FROM job_documents WHERE id = ?').get(docId) as any).folder_id).toBe(folderId);

    await call('db:documents:move', docId, null);
    expect((db.prepare('SELECT folder_id FROM job_documents WHERE id = ?').get(docId) as any).folder_id).toBeNull();
  });

  it('refuses to move a document into a folder from a different job', async () => {
    const otherJobId = Number(db.prepare("INSERT INTO jobs (name, client) VALUES ('J2', 'C')").run().lastInsertRowid);
    const { id: folderId } = await call('db:document-folders:create', otherJobId, null, 'Plans');
    const docId = Number(db.prepare(
      `INSERT INTO job_documents (job_id, filename, stored_name, category, size_bytes, sha256)
       VALUES (?, 'a.pdf', 'a.pdf', 'other', 0, 'h')`
    ).run(jobId).lastInsertRowid);
    await expect(call('db:documents:move', docId, folderId)).rejects.toThrow(/different job/i);
  });

  it('cascades away a job\'s document folders when the job is deleted', async () => {
    await call('db:document-folders:create', jobId, null, 'Plans');
    db.prepare('DELETE FROM jobs WHERE id = ?').run(jobId);
    const remaining = db.prepare('SELECT COUNT(*) c FROM job_document_folders WHERE job_id = ?').get(jobId) as any;
    expect(remaining.c).toBe(0);
  });
});

describe('create text document', () => {
  let db: Database.Database;
  let jobId: number;
  // The electron mock's app.getPath returns '/tmp', so created files land
  // under /tmp/job-files/<jobId>.
  const filesRoot = path.join('/tmp', 'job-files');

  beforeEach(() => {
    handlers.clear();
    db = initializeDatabase(':memory:');
    registerDocumentHandlers(db);
    jobId = Number(db.prepare("INSERT INTO jobs (name, client) VALUES ('J', 'C')").run().lastInsertRowid);
  });

  afterEach(() => {
    fs.rmSync(filesRoot, { recursive: true, force: true });
  });

  it('creates an empty .txt file on disk and a DB row', async () => {
    const { id } = await call('db:documents:create-text', jobId, null, 'Site Notes');
    const row = db.prepare('SELECT * FROM job_documents WHERE id = ?').get(id) as any;
    expect(row).toMatchObject({ job_id: jobId, filename: 'Site Notes.txt', size_bytes: 0, folder_id: null });
    const filePath = path.join(filesRoot, String(jobId), row.stored_name);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('');
  });

  it('keeps an explicit extension instead of forcing .txt', async () => {
    const { id } = await call('db:documents:create-text', jobId, null, 'readme.md');
    const row = db.prepare('SELECT filename FROM job_documents WHERE id = ?').get(id) as any;
    expect(row.filename).toBe('readme.md');
  });

  it('defaults a blank name to New Note.txt', async () => {
    const { id } = await call('db:documents:create-text', jobId, null, '   ');
    const row = db.prepare('SELECT filename FROM job_documents WHERE id = ?').get(id) as any;
    expect(row.filename).toBe('New Note.txt');
  });

  it('creates the file inside a folder', async () => {
    const { id: folderId } = await call('db:document-folders:create', jobId, null, 'Plans');
    const { id } = await call('db:documents:create-text', jobId, folderId, 'Notes');
    const row = db.prepare('SELECT folder_id FROM job_documents WHERE id = ?').get(id) as any;
    expect(row.folder_id).toBe(folderId);
  });

  it('rejects a folder from a different job', async () => {
    const otherJobId = Number(db.prepare("INSERT INTO jobs (name, client) VALUES ('J2', 'C')").run().lastInsertRowid);
    const { id: folderId } = await call('db:document-folders:create', otherJobId, null, 'Plans');
    await expect(call('db:documents:create-text', jobId, folderId, 'Notes')).rejects.toThrow(/folder not found/i);
  });

  it('deduplicates the stored name when a same-named file exists', async () => {
    const { id: first } = await call('db:documents:create-text', jobId, null, 'Notes');
    const { id: second } = await call('db:documents:create-text', jobId, null, 'Notes');
    const a = db.prepare('SELECT stored_name FROM job_documents WHERE id = ?').get(first) as any;
    const b = db.prepare('SELECT stored_name FROM job_documents WHERE id = ?').get(second) as any;
    expect(a.stored_name).toBe('Notes.txt');
    expect(b.stored_name).toBe('Notes (2).txt');
  });
});
