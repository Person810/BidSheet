import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import type Database from 'better-sqlite3';

/**
 * Regression guard for the job-delete path-traversal fix (finding F07).
 * jobId reaches fs.rmSync via removeJobFiles(jobFilesDir(id)); a non-integer
 * or path-ish id from a compromised renderer must never widen the delete
 * target beyond a single job's own folder.
 */
const handlers = new Map<string, (event: any, ...args: any[]) => any>();

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/bidsheet-test-userdata', whenReady: () => Promise.resolve() },
  ipcMain: { handle: (channel: string, fn: any) => handlers.set(channel, fn) },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

import { initializeDatabase } from '../database';
import { jobFilesDir } from './documents';
import { registerJobHandlers } from './jobs';

const call = (channel: string, ...args: any[]) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return fn(null, ...args);
};

describe('jobFilesDir id validation', () => {
  it('returns a path scoped under job-files for a real rowid', () => {
    expect(jobFilesDir(42)).toBe(path.join('/tmp/bidsheet-test-userdata', 'job-files', '42'));
  });

  it.each([
    '../..',
    '../../../etc',
    '1/../../secrets',
    '',
    0,
    -1,
    1.5,
    NaN,
    null,
    undefined,
    {},
  ])('throws on a non-rowid id: %p', (bad) => {
    expect(() => jobFilesDir(bad as unknown as number)).toThrow(/invalid job id/i);
  });
});

describe('db:jobs:delete rejects a traversal id before touching the filesystem', () => {
  let db: Database.Database;

  beforeEach(() => {
    handlers.clear();
    db = initializeDatabase(':memory:');
    registerJobHandlers(db);
  });

  it('throws on a path-like id and never calls fs.rmSync', async () => {
    const rm = vi.spyOn(fs, 'rmSync').mockImplementation(() => undefined);
    try {
      await expect(call('db:jobs:delete', '../..')).rejects.toThrow(/invalid job id/i);
      expect(rm).not.toHaveBeenCalled();
    } finally {
      rm.mockRestore();
    }
  });

  it('still deletes a legitimate job by integer id', async () => {
    const rm = vi.spyOn(fs, 'rmSync').mockImplementation(() => undefined);
    try {
      const id = Number(
        db.prepare("INSERT INTO jobs (name, client) VALUES ('Real Job', 'GC')").run().lastInsertRowid,
      );
      const result = await call('db:jobs:delete', id);
      expect(result.changes).toBe(1);
      expect(db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE id = ?').get(id)).toMatchObject({ n: 0 });
    } finally {
      rm.mockRestore();
    }
  });
});
