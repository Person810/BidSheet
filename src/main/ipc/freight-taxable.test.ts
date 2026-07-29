import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';

/**
 * getFreightTaxable resolves the tri-state app_settings.freight_taxable
 * column against the locale profile's default — and materializes that
 * default as a stored 0/1 on first read, so the flag becomes a synced
 * company setting instead of re-resolving against each machine's OS locale
 * (which would price the same synced job differently per seat).
 * db:settings:save's presence-guarded write is covered here too.
 */
const handlers = new Map<string, (event: any, ...args: any[]) => any>();

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', whenReady: () => Promise.resolve() },
  ipcMain: { handle: (channel: string, fn: any) => handlers.set(channel, fn) },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

import { initializeDatabase } from '../database';
import { getFreightTaxable } from './shared';
import { registerSettingsHandlers } from './settings';

const storedFlag = (db: Database.Database) =>
  (db.prepare('SELECT freight_taxable FROM app_settings WHERE id = 1').get() as any)
    .freight_taxable;

describe('getFreightTaxable', () => {
  let db: Database.Database;

  beforeEach(() => {
    handlers.clear();
    db = initializeDatabase(':memory:');
  });

  it('follows the locale default when the setting is NULL', () => {
    expect(getFreightTaxable(initializeDatabase(':memory:'), 'en-AU')).toBe(true);
    expect(getFreightTaxable(initializeDatabase(':memory:'), 'en-GB')).toBe(true);
    expect(getFreightTaxable(initializeDatabase(':memory:'), 'en-US')).toBe(false);
  });

  it('materializes the resolved default so every later read (and seat) agrees', () => {
    expect(getFreightTaxable(db, 'en-AU')).toBe(true);
    expect(storedFlag(db)).toBe(1);
    // A different locale on a later read no longer matters — the stored
    // value is now the company setting and wins.
    expect(getFreightTaxable(db, 'en-US')).toBe(true);
  });

  it('falls back to the en-US default when no locale is available', () => {
    // The electron mock has no getSystemLocale, exercising the safe fallback.
    expect(getFreightTaxable(db)).toBe(false);
    expect(storedFlag(db)).toBe(0);
  });

  it('lets an explicit setting override the locale default in both directions', () => {
    db.prepare('UPDATE app_settings SET freight_taxable = 0 WHERE id = 1').run();
    expect(getFreightTaxable(db, 'en-AU')).toBe(false);

    db.prepare('UPDATE app_settings SET freight_taxable = 1 WHERE id = 1').run();
    expect(getFreightTaxable(db, 'en-US')).toBe(true);
  });
});

describe('db:settings:save freight_taxable persistence', () => {
  let db: Database.Database;
  const save = (payload: unknown) => {
    const fn = handlers.get('db:settings:save');
    if (!fn) throw new Error('handler not registered');
    return fn(null, payload);
  };
  const base = {
    companyName: 'Acme', defaultOverheadPercent: 10, defaultProfitPercent: 10,
    defaultTaxPercent: 0, defaultBondPercent: 0, jobNumberStart: 1,
  };

  beforeEach(() => {
    handlers.clear();
    db = initializeDatabase(':memory:');
    registerSettingsHandlers(db);
  });

  it('persists an explicit 1 and 0', async () => {
    await save({ ...base, freightTaxable: 1 });
    expect(storedFlag(db)).toBe(1);
    await save({ ...base, freightTaxable: 0 });
    expect(storedFlag(db)).toBe(0);
  });

  it('writes NULL for the "follow locale" choice', async () => {
    await save({ ...base, freightTaxable: 1 });
    await save({ ...base, freightTaxable: null });
    expect(storedFlag(db)).toBeNull();
  });

  it('leaves the stored value untouched when the field is omitted', async () => {
    await save({ ...base, freightTaxable: 1 });
    await save({ ...base }); // an older caller that doesn't know the field
    expect(storedFlag(db)).toBe(1);
  });
});
