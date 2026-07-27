import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';

/**
 * db:job-locations:find-suggestions runs raw SQL against jobs + clients, so
 * this drives the real handler over an in-memory database — the LIKE
 * escaping and the limit clamp are only meaningful against a real engine.
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
import { registerJobHandlers } from './jobs';
import { likeContains } from './shared';

function call(channel: string, ...args: any[]) {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for ${channel}`);
  return fn(null, ...args);
}

const find = (request: unknown) => call('db:job-locations:find-suggestions', request);

describe('likeContains', () => {
  it('escapes LIKE wildcards so input is matched literally', () => {
    expect(likeContains('50%')).toBe('%50\\%%');
    expect(likeContains('a_b')).toBe('%a\\_b%');
    expect(likeContains('back\\slash')).toBe('%back\\\\slash%');
  });

  it('leaves ordinary text alone', () => {
    expect(likeContains('3121')).toBe('%3121%');
  });
});

describe('db:job-locations:find-suggestions', () => {
  let db: Database.Database;

  beforeEach(() => {
    handlers.clear();
    db = initializeDatabase(':memory:');
    registerJobHandlers(db);
  });

  const addJob = (name: string, location: string, postcode: string, country?: string) =>
    db
      .prepare(
        `INSERT INTO jobs (name, client, location, site_postcode, site_country)
         VALUES (?, 'GC', ?, ?, ?)`
      )
      .run(name, location, postcode, country ?? null);

  const addClient = (name: string, address: string) =>
    db.prepare('INSERT INTO clients (name, address) VALUES (?, ?)').run(name, address);

  it('returns nothing when no postcode is supplied', async () => {
    addJob('A', 'Site A', '3121');
    expect(await find({ postalCode: '   ' })).toEqual({ suggestions: [], truncated: false });
  });

  it('finds previously-bid sites by postcode', async () => {
    addJob('A', 'Lot 7 Kembla Rd', '2500', 'Australia');
    const result = await find({ postalCode: '2500' });
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({
      location: 'Lot 7 Kembla Rd',
      postalCode: '2500',
      country: 'Australia',
      sourceKind: 'job',
    });
  });

  it('ranks previous job sites ahead of client office addresses', async () => {
    addClient('Boh Bros', '55 Office Park Dr, 3121');
    addJob('A', 'Trench 4, Wattle St', '3121');
    const { suggestions } = await find({ postalCode: '3121' });
    expect(suggestions.map((s: any) => s.sourceKind)).toEqual(['job', 'client']);
  });

  it('labels client addresses so they are not mistaken for dig sites', async () => {
    addClient('Boh Bros', '55 Office Park Dr, 3121');
    const { suggestions } = await find({ postalCode: '3121' });
    expect(suggestions[0].sourceKind).toBe('client');
  });

  it('treats a wildcard in the query as literal text', async () => {
    addJob('A', 'Site A', '3121');
    addJob('B', 'Site B', '2500');
    // Unescaped, '%' would match every row.
    expect((await find({ postalCode: '%' })).suggestions).toHaveLength(0);
  });

  it('clamps the limit and reports truncation', async () => {
    for (let i = 0; i < 6; i++) addJob(`J${i}`, `Site ${i}`, '3121');
    const result = await find({ postalCode: '3121', limit: 2 });
    expect(result.suggestions).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('does not report truncation when everything fits', async () => {
    addJob('A', 'Site A', '3121');
    const result = await find({ postalCode: '3121', limit: 5 });
    expect(result.suggestions).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });

  it('ignores a hostile limit instead of trusting the renderer', async () => {
    for (let i = 0; i < 3; i++) addJob(`J${i}`, `Site ${i}`, '3121');
    for (const limit of [-1, 0, 9999, NaN, 'lots']) {
      const result = await find({ postalCode: '3121', limit });
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions.length).toBeLessThanOrEqual(50);
    }
  });

  it('narrows by country when one is supplied', async () => {
    addJob('AU', 'Wattle St', '3121', 'Australia');
    addJob('NZ', 'Queen St', '3121', 'New Zealand');
    const { suggestions } = await find({ postalCode: '3121', country: 'Australia' });
    expect(suggestions.map((s: any) => s.location)).toContain('Wattle St');
    expect(suggestions.map((s: any) => s.location)).not.toContain('Queen St');
  });

  it('skips rows with no usable location', async () => {
    db.prepare(
      "INSERT INTO jobs (name, client, location, site_postcode) VALUES ('A', 'GC', NULL, '3121')"
    ).run();
    expect((await find({ postalCode: '3121' })).suggestions).toHaveLength(0);
  });
});
