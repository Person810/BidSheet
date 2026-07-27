import { describe, it, expect, vi } from 'vitest';
import type Database from 'better-sqlite3';

// database.ts imports electron only for getDbPath(); this suite always
// runs migrations against a bare in-memory DB it drives itself, so the
// mock only needs to exist, not do anything.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

import BetterSqlite3 from 'better-sqlite3';
import {
  MIGRATIONS, seedDatabase, seedCatalogStatus, removeSeedCatalog, restoreSeedCatalog,
} from './database';

/** Runs migrations 1..version (1-indexed, matching schema_version) against a fresh DB. */
function dbAtVersion(version: number): Database.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
  for (let v = 1; v <= version; v++) {
    db.transaction(() => MIGRATIONS[v - 1](db))();
  }
  return db;
}

function insertJob(db: Database.Database, name: string): number {
  return Number(db.prepare("INSERT INTO jobs (name, client) VALUES (?, 'C')").run(name).lastInsertRowid);
}

function insertDoc(db: Database.Database, jobId: number, filename: string, category: string) {
  db.prepare(
    `INSERT INTO job_documents (job_id, filename, stored_name, category, size_bytes, sha256)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run(jobId, filename, filename, category, `sha-${filename}`);
}

describe('migration v41 — document folders', () => {
  it('adds job_document_folders and job_documents.folder_id', () => {
    const db = dbAtVersion(41);
    const folderCols = (db.prepare('PRAGMA table_info(job_document_folders)').all() as any[]).map((c) => c.name);
    expect(folderCols).toEqual(
      expect.arrayContaining(['id', 'job_id', 'parent_id', 'name', 'sort_order', 'uuid', 'created_at'])
    );
    const docCols = (db.prepare('PRAGMA table_info(job_documents)').all() as any[]).map((c) => c.name);
    expect(docCols).toContain('folder_id');
  });

  it('backfills one same-named root folder per category actually in use, leaving "other" unfiled', () => {
    const db = dbAtVersion(40);
    const jobId = insertJob(db, 'J');
    insertDoc(db, jobId, 'plan.pdf', 'plans');
    insertDoc(db, jobId, 'quote.pdf', 'quotes');
    insertDoc(db, jobId, 'photo.jpg', 'photos');
    insertDoc(db, jobId, 'misc.txt', 'other');

    db.transaction(() => MIGRATIONS[40](db))(); // migrateV41

    const folders = db.prepare('SELECT * FROM job_document_folders WHERE job_id = ?').all(jobId) as any[];
    expect(folders.map((f) => f.name).sort()).toEqual(['Photos', 'Plans', 'Quotes']);
    expect(folders.every((f) => f.parent_id === null)).toBe(true);

    const docs = db.prepare('SELECT filename, folder_id FROM job_documents WHERE job_id = ?').all(jobId) as any[];
    const byFile = new Map(docs.map((d) => [d.filename, d.folder_id]));
    const folderIdByName = new Map(folders.map((f) => [f.name, f.id]));
    expect(byFile.get('plan.pdf')).toBe(folderIdByName.get('Plans'));
    expect(byFile.get('quote.pdf')).toBe(folderIdByName.get('Quotes'));
    expect(byFile.get('photo.jpg')).toBe(folderIdByName.get('Photos'));
    expect(byFile.get('misc.txt')).toBeNull();
  });

  it('creates no folders for a job whose documents are all "other"', () => {
    const db = dbAtVersion(40);
    const jobId = insertJob(db, 'J2');
    insertDoc(db, jobId, 'x.txt', 'other');

    db.transaction(() => MIGRATIONS[40](db))();

    expect(db.prepare('SELECT * FROM job_document_folders WHERE job_id = ?').all(jobId)).toEqual([]);
  });

  it('keeps each job\'s backfilled folders separate', () => {
    const db = dbAtVersion(40);
    const jobA = insertJob(db, 'A');
    const jobB = insertJob(db, 'B');
    insertDoc(db, jobA, 'a-plan.pdf', 'plans');
    insertDoc(db, jobB, 'b-quote.pdf', 'quotes');

    db.transaction(() => MIGRATIONS[40](db))();

    const foldersA = db.prepare('SELECT name FROM job_document_folders WHERE job_id = ?').all(jobA) as any[];
    const foldersB = db.prepare('SELECT name FROM job_document_folders WHERE job_id = ?').all(jobB) as any[];
    expect(foldersA.map((f) => f.name)).toEqual(['Plans']);
    expect(foldersB.map((f) => f.name)).toEqual(['Quotes']);
  });
});

describe('migration v44 — client records backfill', () => {
  const insertClientJob = (db: Database.Database, client: string, updatedAt: string): number =>
    Number(
      db
        .prepare("INSERT INTO jobs (name, client, updated_at) VALUES ('J', ?, ?)")
        .run(client, updatedAt).lastInsertRowid
    );

  it('creates one client per distinct name (case-insensitive) and links the jobs', () => {
    const db = dbAtVersion(43);
    const older = insertClientJob(db, 'smith construction', '2026-01-01 00:00:00');
    const newer = insertClientJob(db, 'Smith Construction', '2026-02-01 00:00:00');
    const jones = insertClientJob(db, 'Jones Paving', '2026-01-15 00:00:00');
    const blank = insertClientJob(db, '   ', '2026-01-16 00:00:00');

    db.transaction(() => MIGRATIONS[43](db))();

    const clients = db.prepare('SELECT * FROM clients ORDER BY id').all() as any[];
    expect(clients).toHaveLength(2);
    // Display name comes from the most recently updated job in the group
    expect(clients.map((c) => c.name).sort()).toEqual(['Jones Paving', 'Smith Construction']);
    for (const c of clients) expect(c.uuid).toMatch(/^[0-9a-f-]{36}$/);

    const clientIdOf = (jobId: number) =>
      (db.prepare('SELECT client_id FROM jobs WHERE id = ?').get(jobId) as any).client_id;
    expect(clientIdOf(older)).toBe(clientIdOf(newer));
    expect(clientIdOf(jones)).not.toBe(clientIdOf(newer));
    expect(clientIdOf(blank)).toBeNull();
  });
});

describe('migration v46 — hand-picked sidebar tools', () => {
  it('adds enabled_tools and leaves every existing install following its trades', () => {
    const db = dbAtVersion(45);
    db.prepare("UPDATE app_settings SET trade_types = 'water_sewer' WHERE id = 1").run();

    db.transaction(() => MIGRATIONS[45](db))();

    const cols = (db.prepare('PRAGMA table_info(app_settings)').all() as any[]).map((c) => c.name);
    expect(cols).toContain('enabled_tools');
    const row = db.prepare('SELECT trade_types, enabled_tools FROM app_settings WHERE id = 1').get() as any;
    // NULL, not '' — the sidebar keeps following the trades until the user
    // picks for themselves, so nobody's tools move on upgrade.
    expect(row.enabled_tools).toBeNull();
    expect(row.trade_types).toBe('water_sewer');
  });

  it('stores an explicit empty selection distinctly from "never picked"', () => {
    const db = dbAtVersion(MIGRATIONS.length);
    db.prepare("UPDATE app_settings SET enabled_tools = '' WHERE id = 1").run();
    expect((db.prepare('SELECT enabled_tools FROM app_settings WHERE id = 1').get() as any).enabled_tools).toBe('');
  });
});

describe('migration v47 — custom trades', () => {
  it('adds custom_trades without disturbing the trade types that seed catalogs', () => {
    const db = dbAtVersion(46);
    db.prepare("UPDATE app_settings SET trade_types = 'water_sewer' WHERE id = 1").run();

    db.transaction(() => MIGRATIONS[46](db))();

    const cols = (db.prepare('PRAGMA table_info(app_settings)').all() as any[]).map((c) => c.name);
    expect(cols).toContain('custom_trades');
    const row = db.prepare('SELECT trade_types, custom_trades FROM app_settings WHERE id = 1').get() as any;
    expect(row.custom_trades).toBeNull();
    expect(row.trade_types).toBe('water_sewer');
  });
});

describe('migration v49 — freight and site location fields', () => {
  it('adds freight, site_postcode, and site_country columns to jobs table', () => {
    const db = dbAtVersion(48);

    db.transaction(() => MIGRATIONS[48](db))();

    const cols = (db.prepare('PRAGMA table_info(jobs)').all() as any[]).map((c) => c.name);
    expect(cols).toContain('freight');
    expect(cols).toContain('site_postcode');
    expect(cols).toContain('site_country');

    const job_id = insertJob(db, 'Test Job');
    const row = db.prepare('SELECT freight, site_postcode, site_country FROM jobs WHERE id = ?').get(job_id) as any;
    expect(row.freight).toBe(0.0);
    expect(row.site_postcode).toBeNull();
    expect(row.site_country).toBeNull();
  });
});

describe('sample-catalog management', () => {
  const freshDb = () => dbAtVersion(MIGRATIONS.length);

  it('setup can skip the sample catalog entirely, still recording trades', () => {
    const db = freshDb();
    seedDatabase(db, ['water_sewer'], true, 'Co', false, false);
    expect((db.prepare('SELECT COUNT(*) AS n FROM materials').get() as any).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM labor_roles').get() as any).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM equipment').get() as any).n).toBe(0);
    const s = db.prepare('SELECT setup_complete, trade_types FROM app_settings WHERE id = 1').get() as any;
    expect(s.setup_complete).toBe(1);
    expect(s.trade_types).toBe('water_sewer');
    expect(seedCatalogStatus(db)).toEqual({ active: 0, hidden: 0 });
  });

  it('setup leaves the sidebar following the trades unless tools were picked', () => {
    const db = freshDb();
    seedDatabase(db, ['water_sewer'], true, 'Co');
    const row = db.prepare('SELECT enabled_tools, custom_trades FROM app_settings WHERE id = 1').get() as any;
    expect(row.enabled_tools).toBeNull();
    expect(row.custom_trades).toBeNull();
  });

  it('setup records the tools and custom trades entered in the wizard', () => {
    const db = freshDb();
    seedDatabase(db, ['water_sewer'], true, 'Co', false, true, {
      enabledTools: 'concrete-calculator',
      customTrades: 'Directional Drilling,Demolition',
    });
    const row = db.prepare('SELECT enabled_tools, custom_trades FROM app_settings WHERE id = 1').get() as any;
    expect(row.enabled_tools).toBe('concrete-calculator');
    expect(row.custom_trades).toBe('Directional Drilling,Demolition');
  });

  it('setup re-cleans custom trades rather than trusting the renderer', () => {
    const db = freshDb();
    seedDatabase(db, ['water_sewer'], true, 'Co', false, true, {
      customTrades: '  Boring  ,, boring ,   ',
    });
    // Blanks and case-duplicates gone, so nothing round-trips as a junk chip.
    expect((db.prepare('SELECT custom_trades FROM app_settings WHERE id = 1').get() as any).custom_trades)
      .toBe('Boring');
  });

  it('setup with only custom trades seeds nothing and records no trade types', () => {
    const db = freshDb();
    seedDatabase(db, [], true, 'Co', false, false, { customTrades: 'Directional Drilling' });
    expect((db.prepare('SELECT COUNT(*) AS n FROM materials').get() as any).n).toBe(0);
    const row = db.prepare('SELECT setup_complete, trade_types, custom_trades FROM app_settings WHERE id = 1').get() as any;
    expect(row.setup_complete).toBe(1);
    expect(row.trade_types).toBe('');
    expect(row.custom_trades).toBe('Directional Drilling');
  });

  it('hide spares user items and crew-referenced seed labor roles', () => {
    const db = freshDb();
    seedDatabase(db, ['water_sewer'], true, 'Co');
    expect(seedCatalogStatus(db).active).toBeGreaterThan(0);

    const catId = (db.prepare('SELECT id FROM material_categories LIMIT 1').get() as any).id;
    db.prepare("INSERT INTO materials (category_id, name, unit) VALUES (?, 'My Pipe', 'LF')").run(catId);
    const roleId = (db.prepare('SELECT id FROM labor_roles WHERE is_seed = 1 LIMIT 1').get() as any).id;
    const crewId = Number(db.prepare("INSERT INTO crew_templates (name) VALUES ('Crew A')").run().lastInsertRowid);
    db.prepare('INSERT INTO crew_members (crew_template_id, labor_role_id, quantity) VALUES (?, ?, 1)').run(crewId, roleId);

    const removed = removeSeedCatalog(db);
    expect(removed.hidden).toBeGreaterThan(0);
    expect(removed.deletedRoles).toBeGreaterThan(0);

    // The crew-referenced seed role is the only seed item left active
    expect(seedCatalogStatus(db).active).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM labor_roles WHERE id = ?').get(roleId) as any).n).toBe(1);
    // The user's own material is untouched
    expect((db.prepare("SELECT is_active FROM materials WHERE name = 'My Pipe'").get() as any).is_active).toBe(1);
  });

  it('restore un-hides seed items with edits intact and re-creates deleted roles', () => {
    const db = freshDb();
    seedDatabase(db, ['water_sewer'], true, 'Co');
    const mat = db.prepare('SELECT id FROM materials WHERE is_seed = 1 LIMIT 1').get() as any;
    db.prepare('UPDATE materials SET default_unit_cost = 999 WHERE id = ?').run(mat.id);
    const fullActive = seedCatalogStatus(db).active;
    const roleCount = (db.prepare('SELECT COUNT(*) AS n FROM labor_roles WHERE is_seed = 1').get() as any).n;

    removeSeedCatalog(db);
    const r = restoreSeedCatalog(db, true);
    // No crews reference roles here, so hide deleted them all; restore re-creates them
    expect(r.readded).toBe(roleCount);
    expect(r.restored).toBeGreaterThan(0);

    const row = db.prepare('SELECT default_unit_cost, is_active FROM materials WHERE id = ?').get(mat.id) as any;
    expect(row.is_active).toBe(1);
    expect(row.default_unit_cost).toBe(999); // user edit survives the round trip
    expect(seedCatalogStatus(db)).toEqual({ active: fullActive, hidden: 0 });
  });

  it('hide → restore is a clean round trip for assemblies (uuid-keyed, no is_seed column)', () => {
    const db = freshDb();
    seedDatabase(db, ['water_sewer'], true, 'Co');
    const seedAsm = (db.prepare('SELECT COUNT(*) AS n FROM assemblies WHERE is_active = 1').get() as any).n;
    db.prepare("INSERT INTO assemblies (name, unit) VALUES ('My Assembly', 'EA')").run();

    removeSeedCatalog(db);
    expect((db.prepare('SELECT COUNT(*) AS n FROM assemblies WHERE is_active = 1').get() as any).n).toBe(1); // just mine
    restoreSeedCatalog(db, true);
    expect((db.prepare('SELECT COUNT(*) AS n FROM assemblies WHERE is_active = 1').get() as any).n).toBe(seedAsm + 1);
  });
});
