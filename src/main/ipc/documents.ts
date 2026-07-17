import { app, dialog, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { safeHandle } from './shared';
import { logger } from '../logger';
import { isDocumentCategory, uniqueStoredName } from '../../shared/documentFiles';

/**
 * Per-job document store. Attached files are COPIED into
 * userData/job-files/<job-id>/ — never referenced by their original
 * absolute path — so moving or renaming the source file never breaks
 * the job. The DB row keeps the original display name, the stored name,
 * a category, and a sha256 for duplicate detection (and, later, for
 * content-addressed cloud sync like the takeoff plan).
 */

/** Root of the managed store for one job. Exported for the delete hook in jobs.ts. */
export function jobFilesDir(jobId: number): string {
  return path.join(app.getPath('userData'), 'job-files', String(jobId));
}

function documentPath(jobId: number, storedName: string): string {
  // stored_name is produced by uniqueStoredName (no separators), but be
  // defensive: never let a crafted name escape the job folder.
  const dir = jobFilesDir(jobId);
  const resolved = path.resolve(dir, storedName);
  if (!resolved.startsWith(dir + path.sep)) {
    throw new Error('Invalid document name.');
  }
  return resolved;
}

export function registerDocumentHandlers(db: Database.Database): void {
  const listStmt = () =>
    db.prepare('SELECT * FROM job_documents WHERE job_id = ? ORDER BY added_at DESC, id DESC');

  /** Copy files into the job store and insert rows. Returns a result summary. */
  function addFiles(jobId: number, sourcePaths: string[], category: string) {
    const cat = isDocumentCategory(category) ? category : 'other';
    const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId);
    if (!job) throw new Error('Job not found.');

    const dir = jobFilesDir(jobId);
    fs.mkdirSync(dir, { recursive: true });

    const existingNames = () =>
      (db.prepare('SELECT stored_name FROM job_documents WHERE job_id = ?').all(jobId) as any[])
        .map((r) => r.stored_name);
    const existingHashes = new Set(
      (db.prepare('SELECT sha256 FROM job_documents WHERE job_id = ?').all(jobId) as any[])
        .map((r) => r.sha256)
        .filter(Boolean)
    );

    const insert = db.prepare(
      `INSERT INTO job_documents (job_id, filename, stored_name, category, size_bytes, sha256)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    let added = 0;
    let skippedDuplicates = 0;
    const failed: string[] = [];

    for (const sourcePath of sourcePaths) {
      try {
        const stat = fs.statSync(sourcePath);
        if (!stat.isFile()) {
          failed.push(path.basename(sourcePath));
          continue;
        }
        const data = fs.readFileSync(sourcePath);
        const sha = crypto.createHash('sha256').update(data).digest('hex');
        if (existingHashes.has(sha)) {
          skippedDuplicates++;
          continue;
        }
        const originalName = path.basename(sourcePath);
        const storedName = uniqueStoredName(originalName, existingNames());
        fs.writeFileSync(documentPath(jobId, storedName), data);
        insert.run(jobId, originalName, storedName, cat, stat.size, sha);
        existingHashes.add(sha);
        added++;
      } catch (err: any) {
        logger.error('documents:add', `Failed to attach ${sourcePath}`, err.message);
        failed.push(path.basename(sourcePath));
      }
    }

    return { added, skippedDuplicates, failed };
  }

  safeHandle('db:documents:list', (_event, jobId: number) => {
    return listStmt().all(jobId);
  });

  // "Add Files" button: native multi-select dialog, then copy-in.
  safeHandle('db:documents:add', async (_event, jobId: number, category: string) => {
    const result = await dialog.showOpenDialog({
      title: 'Add Documents to Job',
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return addFiles(jobId, result.filePaths, category);
  });

  // Drag-and-drop: the renderer resolves dropped Files to absolute paths
  // via getDroppedFilePath (webUtils) and passes them here.
  safeHandle('db:documents:add-paths', (_event, jobId: number, paths: string[], category: string) => {
    if (!Array.isArray(paths) || paths.length === 0) return { added: 0, skippedDuplicates: 0, failed: [] };
    return addFiles(jobId, paths.map((p) => String(p)), category);
  });

  safeHandle('db:documents:open', async (_event, id: number) => {
    const row = db.prepare('SELECT * FROM job_documents WHERE id = ?').get(id) as any;
    if (!row) throw new Error('Document not found.');
    const filePath = documentPath(row.job_id, row.stored_name);
    if (!fs.existsSync(filePath)) {
      throw new Error('File is missing from the document store. It may have been deleted outside BidSheet.');
    }
    const errMsg = await shell.openPath(filePath);
    if (errMsg) throw new Error(errMsg);
  });

  safeHandle('db:documents:reveal', (_event, id: number) => {
    const row = db.prepare('SELECT * FROM job_documents WHERE id = ?').get(id) as any;
    if (!row) throw new Error('Document not found.');
    const filePath = documentPath(row.job_id, row.stored_name);
    if (!fs.existsSync(filePath)) {
      throw new Error('File is missing from the document store. It may have been deleted outside BidSheet.');
    }
    shell.showItemInFolder(filePath);
  });

  safeHandle('db:documents:update', (_event, id: number, fields: { category?: string; notes?: string | null }) => {
    const row = db.prepare('SELECT id, category, notes FROM job_documents WHERE id = ?').get(id) as any;
    if (!row) throw new Error('Document not found.');
    const category = isDocumentCategory(fields.category) ? fields.category : row.category;
    const notes = fields.notes !== undefined ? fields.notes : row.notes;
    db.prepare('UPDATE job_documents SET category = ?, notes = ? WHERE id = ?').run(category, notes, id);
  });

  safeHandle('db:documents:delete', (_event, id: number) => {
    const row = db.prepare('SELECT * FROM job_documents WHERE id = ?').get(id) as any;
    if (!row) return;
    try {
      fs.rmSync(documentPath(row.job_id, row.stored_name), { force: true });
    } catch (err: any) {
      // The DB row still goes away; an orphaned file is better than a
      // phantom document the user can't remove.
      logger.warn('documents:delete', `Could not remove file for document ${id}`, err.message);
    }
    db.prepare('DELETE FROM job_documents WHERE id = ?').run(id);
  });
}

/**
 * Remove a job's entire document folder. Called from the jobs:delete
 * handler after the DB rows cascade away.
 */
export function removeJobFiles(jobId: number): void {
  try {
    fs.rmSync(jobFilesDir(jobId), { recursive: true, force: true });
  } catch (err: any) {
    logger.warn('documents:cleanup', `Could not remove job-files folder for job ${jobId}`, err.message);
  }
}
