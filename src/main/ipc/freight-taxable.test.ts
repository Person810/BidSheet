import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';

/**
 * getFreightTaxable resolves the tri-state app_settings.freight_taxable
 * column against the locale profile's default, so it's driven over a real
 * in-memory database like the other handler tests.
 */
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', whenReady: () => Promise.resolve() },
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

import { initializeDatabase } from '../database';
import { getFreightTaxable } from './shared';

describe('getFreightTaxable', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initializeDatabase(':memory:');
  });

  it('follows the locale default when the setting is NULL', () => {
    expect(getFreightTaxable(db, 'en-AU')).toBe(true);
    expect(getFreightTaxable(db, 'en-GB')).toBe(true);
    expect(getFreightTaxable(db, 'en-US')).toBe(false);
  });

  it('falls back to the en-US default when no locale is available', () => {
    // The electron mock has no getSystemLocale, exercising the safe fallback.
    expect(getFreightTaxable(db)).toBe(false);
    expect(getFreightTaxable(db, '')).toBe(false);
  });

  it('lets an explicit setting override the locale default in both directions', () => {
    db.prepare('UPDATE app_settings SET freight_taxable = 0 WHERE id = 1').run();
    expect(getFreightTaxable(db, 'en-AU')).toBe(false);

    db.prepare('UPDATE app_settings SET freight_taxable = 1 WHERE id = 1').run();
    expect(getFreightTaxable(db, 'en-US')).toBe(true);
  });
});
