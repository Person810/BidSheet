import { describe, it, expect, beforeEach, vi } from 'vitest';
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
