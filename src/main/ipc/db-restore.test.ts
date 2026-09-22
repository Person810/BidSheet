import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * db:restore must reject a bad pick while the live database is still open:
 * no relaunch, and no touching the live DB. It used to fall into the
 * post-close recovery path for ANY error, so picking a non-SQLite file
 * restarted the app mid-session, and a stale .pre-restore from an earlier
 * interrupted restore was copied over the live database.
 */
const { handlers, showOpenDialog, relaunch, exit, live } = vi.hoisted(() => ({
  handlers: new Map<string, (event: any, ...args: any[]) => any>(),
  showOpenDialog: vi.fn(),
  relaunch: vi.fn(),
  exit: vi.fn(),
  live: { dbPath: '' },
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', whenReady: () => Promise.resolve(), relaunch, exit },
  ipcMain: { handle: (channel: string, fn: any) => handlers.set(channel, fn) },
  dialog: { showOpenDialog, showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../database')>();
  return { ...actual, getDbPath: () => live.dbPath };
});

import { initializeDatabase } from '../database';
import { registerSettingsHandlers } from './settings';

const call = (channel: string, ...args: any[]) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return fn(null, ...args);
};

describe('db:restore validation', () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(() => {
    handlers.clear();
    showOpenDialog.mockReset();
    relaunch.mockReset();
    exit.mockReset();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bidsheet-restore-'));
    live.dbPath = path.join(dir, 'live.db');
    db = initializeDatabase(live.dbPath);
    registerSettingsHandlers(db);
  });

  afterEach(() => {
    try { db.close(); } catch { /* already closed */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a non-SQLite file without relaunching or touching a stale safety copy', async () => {
    const bogus = path.join(dir, 'notes.db');
    fs.writeFileSync(bogus, 'this is not a database, just a mis-named text file');
    // Left behind by an earlier restore that was killed mid-copy.
    fs.writeFileSync(`${live.dbPath}.pre-restore`, 'stale');
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [bogus] });
    const liveBefore = fs.readFileSync(live.dbPath);

    const result = await call('db:restore');

    expect(result).toEqual({ success: false, error: 'This file is not a valid BidSheet database.' });
    expect(relaunch).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(fs.readFileSync(live.dbPath).equals(liveBefore)).toBe(true);
    // The live connection is still usable.
    expect(db.prepare('SELECT id FROM app_settings WHERE id = 1').get()).toBeTruthy();
  });

  it('rejects a backup made by a newer schema version', async () => {
    const newer = path.join(dir, 'newer.db');
    const other = initializeDatabase(newer);
    other.prepare('INSERT INTO schema_version (version) VALUES (9999)').run();
    other.close();
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [newer] });

    const result = await call('db:restore');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/newer version of BidSheet/);
    expect(relaunch).not.toHaveBeenCalled();
  });
});
