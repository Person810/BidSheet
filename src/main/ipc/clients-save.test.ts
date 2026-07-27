import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3';

/**
 * db:clients:save has two write semantics — id = authoritative edit
 * (nulls clear), no id = create-or-link (nulls preserve). The distinction
 * is what stops a blank "new client" form typed with an existing client's
 * name from wiping that client's stored details, so it's driven over a
 * real database.
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
import { registerClientHandlers } from './clients';

const save = (payload: unknown) => {
  const fn = handlers.get('db:clients:save');
  if (!fn) throw new Error('handler not registered');
  return fn(null, payload);
};

describe('db:clients:save', () => {
  let db: Database.Database;

  beforeEach(() => {
    handlers.clear();
    db = initializeDatabase(':memory:');
    registerClientHandlers(db);
  });

  const seedClient = () =>
    Number(
      db
        .prepare(
          `INSERT INTO clients (name, address, contact_name, contact_phone, contact_email, notes)
           VALUES ('Boh Bros', '55 Office Park Dr', 'Pat', '555-0100', 'pat@boh.example', 'net 30')`
        )
        .run().lastInsertRowid
    );

  it('id-less save with an existing name preserves stored details', async () => {
    const id = seedClient();

    // The blank-form case: only the name is provided.
    const result = await save({ name: 'Boh Bros' });
    expect(result.id).toBe(id);

    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(id) as any;
    expect(row.address).toBe('55 Office Park Dr');
    expect(row.contact_name).toBe('Pat');
    expect(row.contact_phone).toBe('555-0100');
    expect(row.contact_email).toBe('pat@boh.example');
    expect(row.notes).toBe('net 30');
  });

  it('id-less save still applies the fields it does provide', async () => {
    const id = seedClient();
    await save({ name: 'Boh Bros', contactPhone: '555-0199' });
    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(id) as any;
    expect(row.contact_phone).toBe('555-0199');
    expect(row.address).toBe('55 Office Park Dr'); // untouched
  });

  it('save with an id remains authoritative — nulls clear fields', async () => {
    const id = seedClient();
    await save({ id, name: 'Boh Bros', address: null, notes: null, contactName: 'Sam' });
    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(id) as any;
    expect(row.address).toBeNull();
    expect(row.notes).toBeNull();
    expect(row.contact_name).toBe('Sam');
  });

  it('id-less save with a new name creates the client', async () => {
    const result = await save({ name: 'Fresh Contractor', address: '1 New St' });
    const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(result.id) as any;
    expect(row.name).toBe('Fresh Contractor');
    expect(row.address).toBe('1 New St');
    expect(row.is_active).toBe(1);
  });

  it('matches names case-insensitively so casing differences cannot fork records', async () => {
    const id = seedClient();
    const result = await save({ name: 'boh bros' });
    expect(result.id).toBe(id);
    expect(db.prepare('SELECT COUNT(*) c FROM clients').get()).toMatchObject({ c: 1 });
  });
});
