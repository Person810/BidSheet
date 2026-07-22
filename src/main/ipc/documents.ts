import { app, dialog, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { safeHandle } from './shared';
import { grantPathAccess, isPathReadable } from './file-access';
import { logger } from '../logger';
import {
  descendantIds,
  sanitizeFilename,
  uniqueSiblingFolderName,
  uniqueStoredName,
  type FolderLike,
} from '../../shared/documentFiles';

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
  const dir = path.resolve(jobFilesDir(jobId));
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
  function addFiles(jobId: number, sourcePaths: string[], folderId: number | null) {
    const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId);
    if (!job) throw new Error('Job not found.');
    if (folderId != null) {
      const folder = db.prepare('SELECT id FROM job_document_folders WHERE id = ? AND job_id = ?').get(folderId, jobId);
      if (!folder) throw new Error('Folder not found.');
    }

    const dir = jobFilesDir(jobId);
    fs.mkdirSync(dir, { recursive: true });

    const existingNames =
      (db.prepare('SELECT stored_name FROM job_documents WHERE job_id = ?').all(jobId) as any[])
        .map((r) => r.stored_name);
    const existingHashes = new Set(
      (db.prepare('SELECT sha256 FROM job_documents WHERE job_id = ?').all(jobId) as any[])
        .map((r) => r.sha256)
        .filter(Boolean)
    );

    const insert = db.prepare(
      `INSERT INTO job_documents (job_id, filename, stored_name, category, size_bytes, sha256, folder_id)
       VALUES (?, ?, ?, 'other', ?, ?, ?)`
    );

    let skippedDuplicates = 0;
    const failed: string[] = [];

    // Copy first, insert rows after: a per-file copy failure only skips that
    // file, and no DB row can exist before its file does.
    const copied: { filename: string; storedName: string; size: number; sha: string }[] = [];
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
        const storedName = uniqueStoredName(originalName, existingNames);
        fs.writeFileSync(documentPath(jobId, storedName), data);
        existingNames.push(storedName);
        existingHashes.add(sha);
        copied.push({ filename: originalName, storedName, size: stat.size, sha });
      } catch (err: any) {
        logger.error('documents:add', `Failed to attach ${sourcePath}`, err.message);
        failed.push(path.basename(sourcePath));
      }
    }

    // All rows land in one transaction; if it fails, remove the copies so
    // the store never holds files the DB doesn't know about.
    let added = 0;
    try {
      db.transaction(() => {
        for (const c of copied) insert.run(jobId, c.filename, c.storedName, c.size, c.sha, folderId);
      })();
      added = copied.length;
    } catch (err: any) {
      logger.error('documents:add', 'Failed to record attached files', err.message);
      for (const c of copied) {
        try {
          fs.rmSync(documentPath(jobId, c.storedName), { force: true });
        } catch (rmErr: any) {
          logger.warn('documents:add', `Could not clean up ${c.storedName}`, rmErr.message);
        }
      }
      failed.push(...copied.map((c) => c.filename));
    }

    return { added, skippedDuplicates, failed };
  }

  safeHandle('db:documents:list', (_event, jobId: number) => {
    return listStmt().all(jobId);
  });

  // "Add Files" button: native multi-select dialog, then copy-in.
  safeHandle('db:documents:add', async (_event, jobId: number, folderId: number | null) => {
    const result = await dialog.showOpenDialog({
      title: 'Add Documents to Job',
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    grantPathAccess(...result.filePaths);
    return addFiles(jobId, result.filePaths, folderId);
  });

  // Drag-and-drop: the renderer resolves dropped Files to absolute paths
  // via getDroppedFilePath (webUtils) and passes them here. Documents are
  // any file type by design, so there's no extension check — but the paths
  // come straight from the renderer, so apply the file-access policy.
  safeHandle('db:documents:add-paths', (_event, jobId: number, paths: string[], folderId: number | null) => {
    if (!Array.isArray(paths) || paths.length === 0) return { added: 0, skippedDuplicates: 0, failed: [] };
    const refused = paths.map((p) => String(p)).filter((p) => !isPathReadable(p));
    const result = addFiles(jobId, paths.map((p) => String(p)).filter((p) => isPathReadable(p)), folderId);
    return { ...result, failed: [...result.failed, ...refused.map((p) => path.basename(p))] };
  });

  // "New Text File": create an empty text document directly in the store
  // (no source file to copy). The renderer opens it right after, so the
  // user lands in their OS text editor ready to type.
  safeHandle('db:documents:create-text', (_event, jobId: number, folderId: number | null, name: string) => {
    const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId);
    if (!job) throw new Error('Job not found.');
    if (folderId != null) {
      const folder = db.prepare('SELECT id FROM job_document_folders WHERE id = ? AND job_id = ?').get(folderId, jobId);
      if (!folder) throw new Error('Folder not found.');
    }

    let filename = sanitizeFilename(String(name || '').trim() || 'New Note');
    if (!/\.[^.]+$/.test(filename)) filename += '.txt';

    const dir = jobFilesDir(jobId);
    fs.mkdirSync(dir, { recursive: true });
    const existingNames = (db.prepare('SELECT stored_name FROM job_documents WHERE job_id = ?').all(jobId) as any[])
      .map((r) => r.stored_name);
    const storedName = uniqueStoredName(filename, existingNames);

    const data = Buffer.alloc(0);
    const sha = crypto.createHash('sha256').update(data).digest('hex');
    fs.writeFileSync(documentPath(jobId, storedName), data);
    const info = db.prepare(
      `INSERT INTO job_documents (job_id, filename, stored_name, category, size_bytes, sha256, folder_id)
       VALUES (?, ?, ?, 'other', 0, ?, ?)`
    ).run(jobId, filename, storedName, sha, folderId);
    return { id: Number(info.lastInsertRowid) };
  });

  // Move a document into a different folder (drag onto the tree, or the
  // "Move to..." picker). folderId = null moves it back to the job root.
  safeHandle('db:documents:move', (_event, id: number, folderId: number | null) => {
    const doc = db.prepare('SELECT id, job_id FROM job_documents WHERE id = ?').get(id) as any;
    if (!doc) throw new Error('Document not found.');
    if (folderId != null) {
      const folder = db.prepare('SELECT id, job_id FROM job_document_folders WHERE id = ?').get(folderId) as any;
      if (!folder) throw new Error('Folder not found.');
      if (folder.job_id !== doc.job_id) throw new Error('Cannot move a document to a folder in a different job.');
    }
    db.prepare('UPDATE job_documents SET folder_id = ? WHERE id = ?').run(folderId, id);
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

  safeHandle('db:documents:update', (_event, id: number, fields: { notes?: string | null }) => {
    const row = db.prepare('SELECT id, notes FROM job_documents WHERE id = ?').get(id) as any;
    if (!row) throw new Error('Document not found.');
    const notes = fields.notes !== undefined ? fields.notes : row.notes;
    db.prepare('UPDATE job_documents SET notes = ? WHERE id = ?').run(notes, id);
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

  // ---- Document folders ----

  safeHandle('db:document-folders:list', (_event, jobId: number) => {
    return db.prepare(
      'SELECT * FROM job_document_folders WHERE job_id = ? ORDER BY sort_order, name COLLATE NOCASE'
    ).all(jobId);
  });

  /** Names of the folders directly inside `parentId` (null = job root), minus `excludeId` if given. */
  function siblingFolderNames(jobId: number, parentId: number | null, excludeId?: number): string[] {
    return (db.prepare(
      'SELECT name FROM job_document_folders WHERE job_id = ? AND parent_id IS ? AND id IS NOT ?'
    ).all(jobId, parentId, excludeId ?? null) as any[]).map((r) => r.name);
  }

  safeHandle('db:document-folders:create', (_event, jobId: number, parentId: number | null, name: string) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('Folder name cannot be empty.');
    if (parentId != null) {
      const parent = db.prepare('SELECT id FROM job_document_folders WHERE id = ? AND job_id = ?').get(parentId, jobId);
      if (!parent) throw new Error('Parent folder not found.');
    }
    // Nothing in the schema stops sibling folders from sharing a name, so
    // dedupe Windows-style here: "Plans" → "Plans - Copy" → "Plans - Copy (2)".
    const finalName = uniqueSiblingFolderName(trimmed, siblingFolderNames(jobId, parentId));
    const maxSort = (db.prepare(
      'SELECT MAX(sort_order) m FROM job_document_folders WHERE job_id = ? AND parent_id IS ?'
    ).get(jobId, parentId) as any)?.m ?? 0;
    const info = db.prepare(
      'INSERT INTO job_document_folders (job_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?)'
    ).run(jobId, parentId, finalName, maxSort + 1);
    return { id: Number(info.lastInsertRowid) };
  });

  safeHandle('db:document-folders:rename', (_event, id: number, name: string) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('Folder name cannot be empty.');
    const row = db.prepare('SELECT id, job_id, parent_id FROM job_document_folders WHERE id = ?').get(id) as any;
    if (!row) throw new Error('Folder not found.');
    // Renaming onto a sibling's name is refused (like Windows), rather than
    // silently deduped — the user typed that exact name on purpose.
    const clash = siblingFolderNames(row.job_id, row.parent_id, id)
      .some((n) => n.toLowerCase() === trimmed.toLowerCase());
    if (clash) throw new Error(`A folder named "${trimmed}" already exists here.`);
    db.prepare('UPDATE job_document_folders SET name = ? WHERE id = ?').run(trimmed, id);
  });

  // Reparents a folder, guarding against moving it into itself or one of its
  // own subfolders (which would detach that whole branch from the tree).
  safeHandle('db:document-folders:move', (_event, id: number, newParentId: number | null) => {
    const folder = db.prepare('SELECT * FROM job_document_folders WHERE id = ?').get(id) as any;
    if (!folder) throw new Error('Folder not found.');
    if (newParentId != null) {
      if (newParentId === id) throw new Error('A folder cannot be moved into itself.');
      const parent = db.prepare('SELECT id, job_id FROM job_document_folders WHERE id = ?').get(newParentId) as any;
      if (!parent) throw new Error('Destination folder not found.');
      if (parent.job_id !== folder.job_id) throw new Error('Cannot move a folder to a different job.');
      const allInJob = db.prepare('SELECT id, parent_id FROM job_document_folders WHERE job_id = ?')
        .all(folder.job_id) as FolderLike[];
      if (descendantIds(allInJob, id).has(newParentId)) {
        throw new Error('Cannot move a folder into one of its own subfolders.');
      }
    }
    // Landing next to a same-named sibling gets the Windows " - Copy" suffix,
    // same as create.
    const newName = uniqueSiblingFolderName(folder.name, siblingFolderNames(folder.job_id, newParentId, id));
    db.prepare('UPDATE job_document_folders SET parent_id = ?, name = ? WHERE id = ?').run(newParentId, newName, id);
  });

  // Only an empty folder can be deleted directly, so a stray click never
  // silently removes files or nested folders.
  safeHandle('db:document-folders:delete', (_event, id: number) => {
    const folder = db.prepare('SELECT id FROM job_document_folders WHERE id = ?').get(id);
    if (!folder) return;
    const childFolders = (db.prepare('SELECT COUNT(*) c FROM job_document_folders WHERE parent_id = ?').get(id) as any).c;
    const childDocs = (db.prepare('SELECT COUNT(*) c FROM job_documents WHERE folder_id = ?').get(id) as any).c;
    if (childFolders > 0 || childDocs > 0) {
      throw new Error('This folder is not empty. Move or delete its contents first.');
    }
    db.prepare('DELETE FROM job_document_folders WHERE id = ?').run(id);
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
