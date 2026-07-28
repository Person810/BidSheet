import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import { TRADE_SEED_DATA, TradeType, SeedAssembly } from '../shared/constants/seed-data';
import { SetupExtras } from '../shared/types/ipc';
import { serializeCustomTrades, parseCustomTrades } from '../shared/customTrades';

/**
 * Tables that get a stable `uuid` column in migration v28. Catalog rows sync
 * by UUID (integer PKs stay local-only — they differ across machines), and
 * job-side entities carry one so future row-level merge has a stable
 * identity to diff on. Vertex tables (takeoff_points, takeoff_area_points)
 * and page-level state are excluded: they aren't mergeable entities, they
 * ride with their parent.
 */
export const UUID_TABLES = [
  // catalog
  'material_categories',
  'materials',
  'labor_roles',
  'crew_templates',
  'production_rates',
  'equipment',
  'assemblies',
  'assembly_items',
  // job-side synced entities
  'bid_sections',
  'bid_line_items',
  'trench_profiles',
  'quotes',
  'takeoff_nodes',
  'takeoff_runs',
  'takeoff_items',
  'takeoff_areas',
  'takeoff_annotations',
] as const;

/**
 * Deterministic UUID for a seed-catalog row, derived from its identity so
 * the same sample item gets the same UUID on every install. That makes
 * cross-install catalog references resolve for seeded items out of the box,
 * and enables "replace sample item with yours" matching later.
 */
export function seedUuid(table: string, name: string): string {
  const h = crypto.createHash('sha256').update(`bidsheet-seed:${table}:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50; // name-derived, version-5 style
  h[8] = (h[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'estimator.db');
}

export function initializeDatabase(dbPath?: string): Database.Database {
  const resolvedPath = dbPath || getDbPath();
  const db = new Database(resolvedPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);
  return db;
}

export function isSetupComplete(db: Database.Database): boolean {
  const row = db.prepare('SELECT setup_complete FROM app_settings WHERE id = 1').get() as any;
  return row?.setup_complete === 1;
}

export function seedDatabase(
  db: Database.Database,
  trades: TradeType[],
  includeBallparkPrices: boolean,
  companyName: string,
  localOnlyMode = false,
  includeSampleCatalog = true,
  // Wizard answers that aren't part of the catalog seed. Both default to null:
  // the sidebar follows the trades (see modules/registry.ts) and there are no
  // custom trades unless the user typed some.
  extras: SetupExtras = {}
): void {
  const seed = db.transaction(() => {
    // Trades are always recorded (they gate which modules/tools are visible);
    // the sample catalog itself is optional.
    if (includeSampleCatalog) seedTradeCatalog(db, trades, includeBallparkPrices);

    // Get current schema version to suppress backup reminder on fresh installs
    const schemaVersion = (db.prepare('SELECT MAX(version) as v FROM schema_version').get() as any)?.v ?? 0;

    db.prepare(
      'UPDATE app_settings SET setup_complete = 1, company_name = ?, trade_types = ?, last_backup_schema_version = ?, local_only_mode = ?, enabled_tools = ?, custom_trades = ? WHERE id = 1'
    ).run(
      companyName, trades.join(','), schemaVersion, localOnlyMode ? 1 : 0,
      extras.enabledTools ?? null,
      // Re-cleaned here rather than trusted: the column's comma separator is
      // the one thing a name may never contain.
      serializeCustomTrades(parseCustomTrades(extras.customTrades))
    );
  });

  seed();
}

/**
 * Seed the catalog (categories, materials, labor, equipment, assemblies) for
 * the given trades. PURELY ADDITIVE: every write is `INSERT OR IGNORE` keyed
 * on a deterministic seed uuid, so rows the user has already edited (prices,
 * densities, etc.) are never updated or deleted — re-seeding a trade is a
 * no-op for anything that already exists. Caller must wrap this in a
 * transaction (seedDatabase and addTradeCatalog both do).
 */
export function seedTradeCatalog(
  db: Database.Database,
  trades: TradeType[],
  includeBallparkPrices: boolean
): void {
  const categoryMap = new Map<string, string>();
  const allMaterials: { category: string; name: string; unit: string; price: number; description?: string; aliases?: string }[] = [];
  const laborMap = new Map<string, { rate: number; burden: number; notes: string }>();
  const equipmentMap = new Map<string, { category: string; hourlyRate: number; mobilization: number; isOwned: boolean; notes: string }>();

  for (const tradeKey of trades) {
    const trade = TRADE_SEED_DATA[tradeKey];
    if (!trade) continue;

    for (const cat of trade.categories) {
      if (!categoryMap.has(cat.name)) {
        categoryMap.set(cat.name, cat.description);
      }
    }

    for (const mat of trade.materials) {
      if (!allMaterials.some((m) => m.name === mat.name && m.category === mat.category)) {
        allMaterials.push({
          category: mat.category,
          name: mat.name,
          unit: mat.unit,
          price: includeBallparkPrices ? mat.ballparkPrice : 0,
          description: mat.description,
          aliases: mat.aliases,
        });
      }
    }

    for (const role of trade.laborRoles) {
      if (!laborMap.has(role.name)) {
        laborMap.set(role.name, { rate: role.rate, burden: role.burden, notes: role.notes });
      }
    }

    for (const equip of trade.equipment) {
      if (!equipmentMap.has(equip.name)) {
        equipmentMap.set(equip.name, {
          category: equip.category,
          hourlyRate: equip.hourlyRate,
          mobilization: equip.mobilization,
          isOwned: equip.isOwned,
          notes: equip.notes,
        });
      }
    }
  }

  // Seed rows carry deterministic UUIDs (seedUuid) so the same sample
  // item has the same identity on every install — cross-install catalog
  // references in synced jobs resolve out of the box.
  const insertCat = db.prepare(
    'INSERT OR IGNORE INTO material_categories (name, description, is_seed, uuid) VALUES (?, ?, 1, ?)'
  );
  for (const [name, desc] of categoryMap) {
    insertCat.run(name, desc, seedUuid('material_categories', name));
  }

  const catRows = db.prepare('SELECT id, name FROM material_categories').all() as { id: number; name: string }[];
  const catIdByName = new Map(catRows.map((r) => [r.name, r.id]));

  // OR IGNORE: the deterministic uuid makes re-seeding a no-op instead of
  // a duplicate row (or, post-v28, a unique-constraint crash).
  const insertMat = db.prepare(
    'INSERT OR IGNORE INTO materials (category_id, name, description, unit, default_unit_cost, aliases, is_seed, uuid) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
  );
  for (const mat of allMaterials) {
    const catId = catIdByName.get(mat.category);
    if (catId) {
      insertMat.run(
        catId, mat.name, mat.description || null, mat.unit, mat.price, mat.aliases || null,
        seedUuid('materials', `${mat.category}/${mat.name}`)
      );
    }
  }

  // Seeded TON aggregates get ballpark densities for CY conversion
  applyDefaultDensities(db);

  const insertRole = db.prepare(
    'INSERT OR IGNORE INTO labor_roles (name, default_hourly_rate, burden_multiplier, notes, is_seed, uuid) VALUES (?, ?, ?, ?, 1, ?)'
  );
  for (const [name, role] of laborMap) {
    insertRole.run(name, role.rate, role.burden, role.notes, seedUuid('labor_roles', name));
  }

  const insertEquip = db.prepare(
    'INSERT OR IGNORE INTO equipment (name, category, hourly_rate, mobilization_cost, is_owned, notes, is_seed, uuid) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
  );
  for (const [name, equip] of equipmentMap) {
    insertEquip.run(
      name, equip.category, equip.hourlyRate, equip.mobilization, equip.isOwned ? 1 : 0,
      equip.notes, seedUuid('equipment', name)
    );
  }

  // Starter assemblies. These are material-only bundles (labor/equipment are
  // left for the estimator to attach via crew/production rates), seeded with
  // deterministic uuids so they re-seed idempotently and carry stable
  // identity across installs for cloud sync. Items resolve to this machine's
  // material ids through each material's own seed uuid.
  const assemblyMap = new Map<string, SeedAssembly>();
  for (const tradeKey of trades) {
    for (const asm of TRADE_SEED_DATA[tradeKey]?.assemblies ?? []) {
      if (!assemblyMap.has(asm.name)) assemblyMap.set(asm.name, asm);
    }
  }
  if (assemblyMap.size > 0) {
    const insertAssembly = db.prepare(
      'INSERT OR IGNORE INTO assemblies (name, description, unit, notes, uuid) VALUES (?, ?, ?, ?, ?)'
    );
    const insertAssemblyItem = db.prepare(
      'INSERT OR IGNORE INTO assembly_items (assembly_id, material_id, quantity, uuid) VALUES (?, ?, ?, ?)'
    );
    const materialIdByUuid = new Map(
      (db.prepare('SELECT id, uuid FROM materials').all() as { id: number; uuid: string }[])
        .map((r) => [r.uuid, r.id])
    );
    for (const asm of assemblyMap.values()) {
      const asmUuid = seedUuid('assemblies', asm.name);
      insertAssembly.run(asm.name, asm.description, asm.unit, asm.notes ?? null, asmUuid);
      const asmId = (db.prepare('SELECT id FROM assemblies WHERE uuid = ?').get(asmUuid) as any)?.id;
      if (!asmId) continue;
      for (const item of asm.items) {
        const matId = materialIdByUuid.get(seedUuid('materials', `${item.category}/${item.name}`));
        if (!matId) continue; // material from an unselected trade — skip
        insertAssemblyItem.run(
          asmId, matId, item.quantity,
          seedUuid('assembly_items', `${asm.name}/${item.category}/${item.name}`)
        );
      }
    }
  }
}

/**
 * Add a trade to an already-set-up database: seed its catalog (additively —
 * see seedTradeCatalog) and append the trade to app_settings.trade_types so
 * its gated module/tools become visible. Never deletes or overwrites existing
 * rows. Returns the updated comma-separated trade_types; a no-op returning the
 * current value when the trade is already active.
 */
export function addTradeCatalog(
  db: Database.Database,
  trade: TradeType,
  includeBallparkPrices: boolean
): string {
  const run = db.transaction(() => {
    const row = db.prepare('SELECT trade_types FROM app_settings WHERE id = 1').get() as
      { trade_types: string | null } | undefined;
    const current = (row?.trade_types ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (current.includes(trade)) return current.join(','); // already active — no-op

    seedTradeCatalog(db, [trade], includeBallparkPrices);

    const next = [...current, trade];
    db.prepare('UPDATE app_settings SET trade_types = ? WHERE id = 1').run(next.join(','));
    return next.join(',');
  });
  return run();
}

// ---- Sample-catalog management ---------------------------------------------
//
// Seed rows are identified by is_seed = 1 (materials, labor_roles, equipment)
// or by their deterministic seed uuid (assemblies, which predate the is_seed
// column and never got one). Rows seeded before v26 are unflagged and are
// deliberately left alone — name-matching could catch user-curated rows.

/** Deterministic uuids of every seed assembly across all trades. */
function seedAssemblyUuids(): string[] {
  const names = new Set<string>();
  for (const trade of Object.values(TRADE_SEED_DATA)) {
    for (const asm of trade.assemblies ?? []) names.add(asm.name);
  }
  return Array.from(names, (name) => seedUuid('assemblies', name));
}

export interface SeedCatalogStatus {
  /** Seed items currently visible in the catalog */
  active: number;
  /** Seed items hidden (soft-deleted); restorable */
  hidden: number;
}

export function seedCatalogStatus(db: Database.Database): SeedCatalogStatus {
  const count = (sql: string, ...params: unknown[]) =>
    (db.prepare(sql).get(...params) as { n: number }).n;
  const asmUuids = seedAssemblyUuids();
  const asmCount = (activeFlag: number) => asmUuids.length === 0 ? 0 : count(
    `SELECT COUNT(*) AS n FROM assemblies WHERE is_active = ${activeFlag} AND uuid IN (${asmUuids.map(() => '?').join(',')})`,
    ...asmUuids
  );
  const active =
    count('SELECT COUNT(*) AS n FROM materials WHERE is_seed = 1 AND is_active = 1') +
    count('SELECT COUNT(*) AS n FROM equipment WHERE is_seed = 1 AND is_active = 1') +
    count('SELECT COUNT(*) AS n FROM labor_roles WHERE is_seed = 1') +
    asmCount(1);
  const hidden =
    count('SELECT COUNT(*) AS n FROM materials WHERE is_seed = 1 AND is_active = 0') +
    count('SELECT COUNT(*) AS n FROM equipment WHERE is_seed = 1 AND is_active = 0') +
    asmCount(0);
  return { active, hidden };
}

/**
 * Hide the sample catalog: soft-deletes seed materials, equipment, and
 * assemblies (is_active = 0 — reversible, and the tombstone syncs), and
 * hard-deletes seed labor roles not referenced by any crew (labor_roles has
 * no is_active column). Nothing the user created or referenced is touched;
 * user-edited seed rows are hidden too, but their data survives and
 * restoreSeedCatalog brings them back unchanged.
 */
export function removeSeedCatalog(db: Database.Database): { hidden: number; deletedRoles: number } {
  const run = db.transaction(() => {
    let hidden = 0;
    hidden += db.prepare('UPDATE materials SET is_active = 0 WHERE is_seed = 1 AND is_active = 1').run().changes;
    hidden += db.prepare('UPDATE equipment SET is_active = 0 WHERE is_seed = 1 AND is_active = 1').run().changes;
    const asmUuids = seedAssemblyUuids();
    if (asmUuids.length > 0) {
      hidden += db.prepare(
        `UPDATE assemblies SET is_active = 0 WHERE is_active = 1 AND uuid IN (${asmUuids.map(() => '?').join(',')})`
      ).run(...asmUuids).changes;
    }
    const deletedRoles = db.prepare(
      'DELETE FROM labor_roles WHERE is_seed = 1 AND id NOT IN (SELECT labor_role_id FROM crew_members)'
    ).run().changes;
    return { hidden, deletedRoles };
  });
  return run();
}

/**
 * Restore the sample catalog for the currently active trades: re-activates
 * hidden seed rows (they keep whatever values they had — user edits survive)
 * and re-inserts seed rows that no longer exist (fresh seed values;
 * `includeBallparkPrices` applies only to those). Existing active rows are
 * never modified — seedTradeCatalog is INSERT OR IGNORE on the seed uuid.
 */
export function restoreSeedCatalog(
  db: Database.Database,
  includeBallparkPrices: boolean
): { restored: number; readded: number } {
  const run = db.transaction(() => {
    const row = db.prepare('SELECT trade_types FROM app_settings WHERE id = 1').get() as
      { trade_types: string | null } | undefined;
    const trades = (row?.trade_types ?? '')
      .split(',').map((s) => s.trim()).filter((t): t is TradeType => t in TRADE_SEED_DATA);

    let restored = 0;
    restored += db.prepare('UPDATE materials SET is_active = 1 WHERE is_seed = 1 AND is_active = 0').run().changes;
    restored += db.prepare('UPDATE equipment SET is_active = 1 WHERE is_seed = 1 AND is_active = 0').run().changes;
    const asmUuids = seedAssemblyUuids();
    if (asmUuids.length > 0) {
      restored += db.prepare(
        `UPDATE assemblies SET is_active = 1 WHERE is_active = 0 AND uuid IN (${asmUuids.map(() => '?').join(',')})`
      ).run(...asmUuids).changes;
    }

    const before = seedCatalogStatus(db).active;
    seedTradeCatalog(db, trades, includeBallparkPrices);
    const readded = seedCatalogStatus(db).active - before;
    return { restored, readded };
  });
  return run();
}

// Ordered list of migrations; index 0 is v1. Each runs inside its own
// transaction (below), so a multi-statement migration is all-or-nothing.
// Exported so tests can run a specific prefix of migrations (e.g. to seed
// pre-upgrade data and verify a single migration's backfill in isolation).
export const MIGRATIONS: Array<(db: Database.Database) => void> = [
  migrateV1, migrateV2, migrateV3, migrateV4, migrateV5,
  migrateV6, migrateV7, migrateV8, migrateV9, migrateV10,
  migrateV11, migrateV12, migrateV13, migrateV14, migrateV15,
  migrateV16, migrateV17, migrateV18, migrateV19, migrateV20,
  migrateV21, migrateV22, migrateV23, migrateV24, migrateV25,
  migrateV26, migrateV27, migrateV28, migrateV29, migrateV30,
  migrateV31,
  migrateV32,
  migrateV33,
  migrateV34,
  migrateV35,
  migrateV36,
  migrateV37,
  migrateV38,
  migrateV39,
  migrateV40,
  migrateV41,
  migrateV42,
  migrateV43,
  migrateV44,
  migrateV45,
  migrateV46,
  migrateV47,
  migrateV48,
  migrateV49,
  migrateV50,
];

function runMigrations(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');

  const currentVersion = db.prepare(
    'SELECT MAX(version) as version FROM schema_version'
  ).get() as { version: number | null };

  const version = currentVersion?.version ?? 0;

  // Each migrateVn ends by inserting its schema_version row, but a bare
  // db.exec autocommits per statement — a crash partway through left a
  // half-applied schema with no version recorded, so the next launch re-ran
  // the migration and died on "table already exists". Wrapping each migration
  // in a transaction makes it atomic: it either fully applies (schema + version
  // bump together) or rolls back to be retried cleanly next launch.
  for (let v = version + 1; v <= MIGRATIONS.length; v++) {
    const migrate = MIGRATIONS[v - 1];
    db.transaction(() => migrate(db))();
  }
}

function migrateV29(db: Database.Database): void {
  // Catalog sync bookkeeping (Phase 3d) — same two-hash pattern as
  // cloud_sync_state, account-wide instead of per-job: local hash detects
  // local catalog edits, remote hash detects another seat's push.
  db.exec(`
    CREATE TABLE cloud_catalog_sync (
      id               INTEGER PRIMARY KEY CHECK (id = 1),
      last_hash_local  TEXT,
      last_hash_remote TEXT,
      last_synced_at   TEXT
    );
    INSERT INTO cloud_catalog_sync (id) VALUES (1);
    INSERT INTO schema_version (version) VALUES (29);
  `);
}

function migrateV30(db: Database.Database): void {
  // Cached end-to-end encryption key (zero-knowledge sync). dek_enc is the
  // account's random Data Encryption Key wrapped with the OS keychain
  // (safeStorage, same as the refresh token / backup key), so day-to-day sync
  // never re-prompts for the recovery key. dek_fingerprint lets this device
  // notice if the cloud's DEK ever changed out from under its cache. The
  // recovery key itself is never stored anywhere.
  db.exec(`
    ALTER TABLE cloud_auth ADD COLUMN dek_enc TEXT;
    ALTER TABLE cloud_auth ADD COLUMN dek_fingerprint TEXT;
    INSERT INTO schema_version (version) VALUES (30);
  `);
}

function migrateV32(db: Database.Database): void {
  // Sticky manual overrides (§5). A JSON array of the derived line fields the
  // estimator has typed over (materialUnitCost / laborHours / laborCostPerHour
  // / equipmentCostPerHour), so a later driver change won't silently recompute
  // them and the override can be badged + reverted in the UI.
  db.exec(`
    ALTER TABLE bid_line_items ADD COLUMN manual_fields TEXT;
    INSERT INTO schema_version (version) VALUES (32);
  `);
}

function migrateV31(db: Database.Database): void {
  // Per-job price import (§1–4). Three pieces:
  //
  //  1. raw_quote_lines — every incoming quote row stored verbatim and
  //     immutably. This is both provenance ("where did this number come
  //     from") and the single ingestion point a future PDF parser feeds, so
  //     PDF becomes just another way to populate this table.
  //
  //  2. quote_aliases — the learned matcher's memory: a (supplier, normalized
  //     description) key that resolves to a catalog material. Every confirm in
  //     the reconciliation screen writes one, so the same supplier's rows
  //     auto-match on the next job and the matcher converges after a few bids.
  //
  //  3. price_state / price_source on bid_line_items — the signature
  //     price-state system. 'seed' = unverified placeholder, 'past_price' = a
  //     real but older number, 'quoted' = a quote came in for THIS job,
  //     'confirmed' = locked in. Existing lines that already carry a real
  //     material price are backfilled to 'past_price' so nothing that the user
  //     hand-built reads as an untrusted seed; everything else stays 'seed'.
  db.exec(`
    CREATE TABLE raw_quote_lines (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
      supplier    TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      unit        TEXT,
      price       REAL NOT NULL DEFAULT 0,
      part_number TEXT,
      source      TEXT,
      imported_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX idx_raw_quote_lines_job ON raw_quote_lines(job_id);

    CREATE TABLE quote_aliases (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier        TEXT NOT NULL DEFAULT '',
      raw_description TEXT NOT NULL,
      material_id     INTEGER REFERENCES materials(id) ON DELETE CASCADE,
      part_number     TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      UNIQUE(supplier, raw_description)
    );
    CREATE INDEX idx_quote_aliases_material ON quote_aliases(material_id);

    ALTER TABLE bid_line_items ADD COLUMN price_state TEXT NOT NULL DEFAULT 'seed';
    ALTER TABLE bid_line_items ADD COLUMN price_source TEXT;

    UPDATE bid_line_items SET price_state = 'past_price' WHERE material_unit_cost > 0;

    INSERT INTO schema_version (version) VALUES (31);
  `);
}

function migrateV33(db: Database.Database): void {
  // Per-member E2EE keys (multi-user orgs). Under the format-2 scheme the
  // recovery key wraps this member's X25519 private key (member_priv_enc,
  // safeStorage-wrapped like dek_enc); the account DEK is then reached by
  // opening the DEK sealed to this member's public key. member_pub caches the
  // raw public key (base64); e2ee_format caches which scheme the account is on
  // (1 = legacy single-key, 2 = per-member) so the client knows how to unlock.
  db.exec(`
    ALTER TABLE cloud_auth ADD COLUMN member_priv_enc TEXT;
    ALTER TABLE cloud_auth ADD COLUMN member_pub TEXT;
    ALTER TABLE cloud_auth ADD COLUMN e2ee_format INTEGER;
    INSERT INTO schema_version (version) VALUES (33);
  `);
}

function migrateV34(db: Database.Database): void {
  db.exec(`
    ALTER TABLE app_settings ADD COLUMN pdf_template_json TEXT;
    INSERT INTO schema_version (version) VALUES (34);
  `);
}

// V35: Earthwork takeoff. Existing/proposed elevation surfaces (spot
// elevations -> a TIN for cut/fill against the terrain), plus two columns on
// takeoff_areas so an area polygon can double as a proposed-grade region.
// grade_mode NULL keeps the area as ordinary surface restoration (unchanged).
//
// takeoff_surfaces gets its own uuid column + autofill trigger to match the
// sibling takeoff tables, but is deliberately kept out of UUID_TABLES: that
// constant drives the historical v28 backfill loop, which would fail trying to
// ALTER a table that doesn't exist yet on a fresh, sequential migration.
function migrateV35(db: Database.Database): void {
  db.exec(`
    CREATE TABLE takeoff_surfaces (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL DEFAULT 'existing',   -- 'existing' | 'proposed'
      name        TEXT NOT NULL DEFAULT '',
      uuid        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX idx_takeoff_surfaces_job ON takeoff_surfaces(job_id);
    UPDATE takeoff_surfaces SET uuid = ${SQL_RANDOM_UUID} WHERE uuid IS NULL;
    CREATE UNIQUE INDEX idx_takeoff_surfaces_uuid ON takeoff_surfaces(uuid);
    CREATE TRIGGER trg_takeoff_surfaces_uuid AFTER INSERT ON takeoff_surfaces WHEN NEW.uuid IS NULL
    BEGIN
      UPDATE takeoff_surfaces SET uuid = ${SQL_RANDOM_UUID} WHERE id = NEW.id;
    END;

    CREATE TABLE takeoff_surface_points (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      surface_id  INTEGER NOT NULL REFERENCES takeoff_surfaces(id) ON DELETE CASCADE,
      x           REAL NOT NULL,    -- PDF-native px (at scale=1)
      y           REAL NOT NULL,
      z_ft        REAL NOT NULL,    -- elevation, feet
      pdf_page    INTEGER NOT NULL DEFAULT 1,
      sort_order  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_takeoff_surface_points_surface
      ON takeoff_surface_points(surface_id);

    -- Proposed-grade regions: a takeoff_area with grade_mode set is earthwork.
    ALTER TABLE takeoff_areas ADD COLUMN grade_mode TEXT;       -- 'cut_depth'|'fill_depth'|'finished_elev'
    ALTER TABLE takeoff_areas ADD COLUMN grade_value_ft REAL;   -- depth, or finished elevation

    INSERT INTO schema_version (version) VALUES (35);
  `);
}

// V36: Wall-run takeoff — open polylines measured by length, expanded to
// concrete volume + formwork contact area (SFCA) + optional rebar grid. A
// parallel entity to takeoff_areas (which stay closed polygons); created
// after v28 so it carries its own uuid handling rather than going through
// UUID_TABLES.
function migrateV36(db: Database.Database): void {
  db.exec(`
    CREATE TABLE takeoff_walls (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id          INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      label           TEXT NOT NULL DEFAULT '',
      height_ft       REAL NOT NULL DEFAULT 8,
      thickness_in    REAL NOT NULL DEFAULT 8,
      faces           INTEGER NOT NULL DEFAULT 2,
      rebar_spacing_in REAL NOT NULL DEFAULT 0,
      material_id     INTEGER REFERENCES materials(id),
      assembly_id     INTEGER REFERENCES assemblies(id),
      color           TEXT NOT NULL DEFAULT '#6D4C41',
      sort_order      INTEGER NOT NULL DEFAULT 0,
      pdf_page        INTEGER NOT NULL DEFAULT 1,
      uuid            TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX idx_takeoff_walls_job ON takeoff_walls(job_id);
    UPDATE takeoff_walls SET uuid = ${SQL_RANDOM_UUID} WHERE uuid IS NULL;
    CREATE UNIQUE INDEX idx_takeoff_walls_uuid ON takeoff_walls(uuid);
    CREATE TRIGGER trg_takeoff_walls_uuid AFTER INSERT ON takeoff_walls WHEN NEW.uuid IS NULL
    BEGIN
      UPDATE takeoff_walls SET uuid = ${SQL_RANDOM_UUID} WHERE id = NEW.id;
    END;

    CREATE TABLE takeoff_wall_points (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      wall_id     INTEGER NOT NULL REFERENCES takeoff_walls(id) ON DELETE CASCADE,
      x_px        REAL NOT NULL,
      y_px        REAL NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_takeoff_wall_points_wall ON takeoff_wall_points(wall_id);

    INSERT INTO schema_version (version) VALUES (36);
  `);
}

// V37: Compaction/waste percent on trench profiles (issue #9, trimmed scope).
// Extra loose material purchased per compacted CY of imported bedding/backfill.
function migrateV37(db: Database.Database): void {
  db.exec(`
    ALTER TABLE trench_profiles ADD COLUMN compaction_pct REAL NOT NULL DEFAULT 0;

    INSERT INTO schema_version (version) VALUES (37);
  `);
}

// V38: Per-job documents. Files are copied into the app-managed store
// (userData/job-files/<job-id>/) under stored_name; filename keeps the
// original display name. sha256/size support future cloud sync
// (content-addressed upload, like the takeoff plan) and duplicate detection.
function migrateV38(db: Database.Database): void {
  db.exec(`
    CREATE TABLE job_documents (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      filename    TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      category    TEXT NOT NULL DEFAULT 'other',
      size_bytes  INTEGER NOT NULL DEFAULT 0,
      sha256      TEXT NOT NULL DEFAULT '',
      notes       TEXT,
      uuid        TEXT,
      added_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX idx_job_documents_job ON job_documents(job_id);
    CREATE UNIQUE INDEX idx_job_documents_uuid ON job_documents(uuid);
    CREATE TRIGGER trg_job_documents_uuid AFTER INSERT ON job_documents WHEN NEW.uuid IS NULL
    BEGIN
      UPDATE job_documents SET uuid = ${SQL_RANDOM_UUID} WHERE id = NEW.id;
    END;

    INSERT INTO schema_version (version) VALUES (38);
  `);
}

// V39: Job-level indirect costs (mobilization, traffic control, dewatering…)
// entered once per job instead of faked as line items. Job-level markups
// apply to the pool in bidCalc; tax/escalation do not.
function migrateV39(db: Database.Database): void {
  db.exec(`
    CREATE TABLE job_indirect_costs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      amount      REAL NOT NULL DEFAULT 0,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      uuid        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX idx_job_indirects_job ON job_indirect_costs(job_id);
    CREATE UNIQUE INDEX idx_job_indirects_uuid ON job_indirect_costs(uuid);
    CREATE TRIGGER trg_job_indirects_uuid AFTER INSERT ON job_indirect_costs WHEN NEW.uuid IS NULL
    BEGIN
      UPDATE job_indirect_costs SET uuid = ${SQL_RANDOM_UUID} WHERE id = NEW.id;
    END;

    INSERT INTO schema_version (version) VALUES (39);
  `);
}

// V40: Reusable bid section templates. items_json holds a snapshot of the
// section's bid_line_items rows (ids stripped) so a standard package —
// "8-inch sanitary sewer", "hydrant assembly" — drops into any job. JSON
// keeps the snapshot resilient to future line-item columns; unknown keys
// are filtered against the live schema on insert.
function migrateV40(db: Database.Database): void {
  db.exec(`
    CREATE TABLE section_templates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      items_json  TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      uuid        TEXT
    );
    CREATE UNIQUE INDEX idx_section_templates_uuid ON section_templates(uuid);
    CREATE TRIGGER trg_section_templates_uuid AFTER INSERT ON section_templates WHEN NEW.uuid IS NULL
    BEGIN
      UPDATE section_templates SET uuid = ${SQL_RANDOM_UUID} WHERE id = NEW.id;
    END;

    INSERT INTO schema_version (version) VALUES (40);
  `);
}

// V41: Nested folders for job documents, replacing the fixed 6-category
// tagging. A document's location is now folder_id (NULL = job root) instead
// of category; category stays on the row (unused by new code) rather than
// being dropped, since SQLite can't cheaply drop a column with data workers
// might still be reading via an older build mid-upgrade.
//
// Existing documents are backfilled into one same-named root folder per
// category actually in use on each job ('other' stays unfiled at root,
// since it was always the catch-all — the closest existing thing to "no
// folder").
function migrateV41(db: Database.Database): void {
  db.exec(`
    CREATE TABLE job_document_folders (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      parent_id   INTEGER REFERENCES job_document_folders(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      uuid        TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX idx_job_document_folders_job ON job_document_folders(job_id);
    CREATE INDEX idx_job_document_folders_parent ON job_document_folders(parent_id);
    CREATE UNIQUE INDEX idx_job_document_folders_uuid ON job_document_folders(uuid);
    CREATE TRIGGER trg_job_document_folders_uuid AFTER INSERT ON job_document_folders WHEN NEW.uuid IS NULL
    BEGIN
      UPDATE job_document_folders SET uuid = ${SQL_RANDOM_UUID} WHERE id = NEW.id;
    END;

    ALTER TABLE job_documents ADD COLUMN folder_id INTEGER REFERENCES job_document_folders(id) ON DELETE SET NULL;
    CREATE INDEX idx_job_documents_folder ON job_documents(folder_id);
  `);

  const CATEGORY_FOLDER_NAMES: Record<string, string> = {
    plans: 'Plans',
    quotes: 'Quotes',
    specs: 'Specs',
    photos: 'Photos',
    contracts: 'Contracts',
    // 'other' intentionally omitted: it stays unfiled at root.
  };

  const jobsWithCategorizedDocs = db.prepare(`
    SELECT DISTINCT job_id, category FROM job_documents
    WHERE category IN ('plans', 'quotes', 'specs', 'photos', 'contracts')
  `).all() as { job_id: number; category: string }[];

  const insertFolder = db.prepare(
    'INSERT INTO job_document_folders (job_id, parent_id, name) VALUES (?, NULL, ?)'
  );
  const backfillDocs = db.prepare(
    'UPDATE job_documents SET folder_id = ? WHERE job_id = ? AND category = ?'
  );

  for (const { job_id, category } of jobsWithCategorizedDocs) {
    const folderId = insertFolder.run(job_id, CATEGORY_FOLDER_NAMES[category]).lastInsertRowid;
    backfillDocs.run(folderId, job_id, category);
  }

  db.exec('INSERT INTO schema_version (version) VALUES (41);');
}

// V42: generalize the wall tool beyond concrete — the per-face "rebar grid"
// becomes a trade-agnostic vertical-member spacing (studs / bars / posts).
function migrateV42(db: Database.Database): void {
  db.exec(`
    ALTER TABLE takeoff_walls RENAME COLUMN rebar_spacing_in TO member_spacing_in;
    INSERT INTO schema_version (version) VALUES (42);
  `);
}

// V43: Auto-suggested job numbers (#95). Suggest-don't-enforce: the create-
// job form pre-fills the next number in this format but the field stays
// editable (contractors often must match a GC's or legacy numbering), and a
// duplicate warns instead of failing — existing data may already hold blanks
// or dupes. The next number is derived from the max existing match at
// creation time (see shared/jobNumbering.ts), so there is no stored counter
// to drift across synced machines.
function migrateV43(db: Database.Database): void {
  db.exec(`
    ALTER TABLE app_settings ADD COLUMN job_number_auto INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE app_settings ADD COLUMN job_number_format TEXT NOT NULL DEFAULT 'YYYY-NNN';
    ALTER TABLE app_settings ADD COLUMN job_number_start INTEGER NOT NULL DEFAULT 1;
    INSERT INTO schema_version (version) VALUES (43);
  `);
}

// V44: Reusable client records (#94). jobs.client stays the denormalized
// display name — CSV export, sorting, and the dashboard's win-rate-by-client
// all keep reading it unchanged — while jobs.client_id links the canonical
// record that carries address/contact details. db:jobs:save re-derives
// client_id from the typed name on every save (find-or-create), so the link
// tracks the text and can never go stale. Clients sync account-wide with the
// catalog snapshot, so rows get the v28-style uuid + autofill trigger.
function migrateV44(db: Database.Database): void {
  db.exec(`
    CREATE TABLE clients (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      address       TEXT,
      contact_name  TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      notes         TEXT,
      is_active     INTEGER NOT NULL DEFAULT 1,
      uuid          TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE UNIQUE INDEX idx_clients_uuid ON clients(uuid);
    CREATE TRIGGER trg_clients_uuid AFTER INSERT ON clients WHEN NEW.uuid IS NULL
    BEGIN
      UPDATE clients SET uuid = ${SQL_RANDOM_UUID} WHERE id = NEW.id;
    END;

    ALTER TABLE jobs ADD COLUMN client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;
    CREATE INDEX idx_jobs_client ON jobs(client_id);
  `);

  // Backfill: one client per distinct existing name (case-insensitive —
  // "Smith Const." and "smith const." were always the same client), keeping
  // the capitalization from the most recently updated job that used it.
  const jobs = db
    .prepare(
      `SELECT id, TRIM(client) AS name FROM jobs
       WHERE TRIM(COALESCE(client, '')) != ''
       ORDER BY updated_at DESC, id DESC`
    )
    .all() as { id: number; name: string }[];
  const insertClient = db.prepare('INSERT INTO clients (name) VALUES (?)');
  const linkJob = db.prepare('UPDATE jobs SET client_id = ? WHERE id = ?');
  const idByKey = new Map<string, number>();
  for (const job of jobs) {
    const key = job.name.toLowerCase();
    let clientId = idByKey.get(key);
    if (clientId === undefined) {
      clientId = Number(insertClient.run(job.name).lastInsertRowid);
      idByKey.set(key, clientId);
    }
    linkJob.run(clientId, job.id);
  }

  db.exec('INSERT INTO schema_version (version) VALUES (44);');
}

// V45: Metric units toggle (#97). Purely presentational — every stored
// dimension stays canonical imperial (ft/in/CY columns keep their meaning
// on every machine regardless of this setting); metric users get conversion
// at the render/input boundary via shared/unitSystem.ts. Syncs with the
// other company settings so all of an account's machines agree.
function migrateV45(db: Database.Database): void {
  db.exec(`
    ALTER TABLE app_settings ADD COLUMN unit_system TEXT NOT NULL DEFAULT 'imperial';
    INSERT INTO schema_version (version) VALUES (45);
  `);
}

// V46: Hand-picked sidebar tools. trade_types decides two unrelated things —
// which catalog gets seeded, and which trade tools appear — so the only way
// to get the concrete calculator was to add the concrete trade and live with
// its materials in your catalog forever (seeding is additive and never
// removed). enabled_tools breaks that tie: a comma-separated list of tool
// ids that replaces the trade-derived set.
//
// NULL means "follow my trades", which is every existing install — the
// column is deliberately not backfilled, so nobody's sidebar moves until
// they choose to pick tools themselves. An empty string is a real choice
// ("show me no tools"), which is why NULL and '' aren't the same thing here.
function migrateV46(db: Database.Database): void {
  db.exec(`
    ALTER TABLE app_settings ADD COLUMN enabled_tools TEXT;
    INSERT INTO schema_version (version) VALUES (46);
  `);
}

// V47: Trades we have no seed catalog for, typed by the user at setup
// ("Directional Drilling", "Demolition"). They can't live in trade_types —
// that column is a controlled vocabulary that drives catalog seeding and
// module lookup, and a free-text name would either be silently ignored there
// or, worse, have to be guarded against at every read. Kept separate, it is
// what it is: a label, with the tools chosen independently (see v46).
function migrateV47(db: Database.Database): void {
  db.exec(`
    ALTER TABLE app_settings ADD COLUMN custom_trades TEXT;
    INSERT INTO schema_version (version) VALUES (47);
  `);
}

function migrateV48(db: Database.Database): void {
  // Intentional no-op. It shipped ahead of the HDD branch, which had already
  // written its trench-profile DDL as V48 locally.
  //
  // DO NOT reclaim this number, and DO NOT renumber V49 to close the gap.
  // Anyone who has run this build is recorded at schema_version 49, so a
  // migration numbered 48 or 49 will never execute for them — runMigrations
  // starts at MAX(version) + 1. The HDD work must land as V50 or later.
  // Renumbering to tidy this up silently skips the migration on exactly the
  // machines that already have the feature branch checked out.
  db.exec(`
    INSERT INTO schema_version (version) VALUES (48);
  `);
}

function migrateV49(db: Database.Database): void {
  db.exec(`
    ALTER TABLE jobs ADD COLUMN freight REAL NOT NULL DEFAULT 0.0;
    ALTER TABLE jobs ADD COLUMN site_postcode TEXT;
    ALTER TABLE jobs ADD COLUMN site_country TEXT;
    INSERT INTO schema_version (version) VALUES (49);
  `);
}

function migrateV50(db: Database.Database): void {
  // Whether the job tax rate applies to freight. Tri-state on purpose:
  // NULL = follow the locale profile's default (GST/VAT locales tax
  // freight, en-US doesn't), 0/1 = explicit user override. No backfill —
  // existing installs keep locale-default behavior.
  db.exec(`
    ALTER TABLE app_settings ADD COLUMN freight_taxable INTEGER;
    INSERT INTO schema_version (version) VALUES (50);
  `);
}

/** UUIDv4 as a SQLite expression — evaluated fresh per row. */
const SQL_RANDOM_UUID = `lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
  substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) ||
  substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
)`;

function migrateV28(db: Database.Database): void {
  // Stable UUIDs (the pre-iOS gate): catalog rows sync by uuid instead of
  // integer id, so a restored catalog with different AUTOINCREMENT ids no
  // longer breaks every synced job's material/crew/equipment links.
  // Job-side entities get one too, for future row-level merge.
  //
  // Wizard-seeded rows (is_seed = 1) are backfilled with deterministic
  // name-derived UUIDs so the same sample item has the same identity on
  // every install; everything else gets a random v4. AFTER INSERT triggers
  // keep new rows covered without touching any of the existing insert
  // sites — an explicit uuid in the INSERT (seeding, snapshot import) wins.
  const migrate = db.transaction(() => {
    for (const t of UUID_TABLES) {
      db.exec(`ALTER TABLE ${t} ADD COLUMN uuid TEXT;`);
    }

    const seeded = new Set<string>(); // skip duplicate names defensively
    const backfillSeed = (table: string, rows: { id: number; key: string }[]) => {
      const upd = db.prepare(`UPDATE ${table} SET uuid = ? WHERE id = ?`);
      for (const row of rows) {
        const u = seedUuid(table, row.key);
        if (seeded.has(u)) continue;
        seeded.add(u);
        upd.run(u, row.id);
      }
    };
    for (const t of ['material_categories', 'labor_roles', 'equipment']) {
      backfillSeed(
        t,
        (db.prepare(`SELECT id, name AS key FROM ${t} WHERE is_seed = 1`).all() as any[])
      );
    }
    backfillSeed(
      'materials',
      db
        .prepare(
          `SELECT m.id, c.name || '/' || m.name AS key
           FROM materials m JOIN material_categories c ON c.id = m.category_id
           WHERE m.is_seed = 1`
        )
        .all() as any[]
    );

    for (const t of UUID_TABLES) {
      db.exec(`
        UPDATE ${t} SET uuid = ${SQL_RANDOM_UUID} WHERE uuid IS NULL;
        CREATE UNIQUE INDEX idx_${t}_uuid ON ${t}(uuid);
        CREATE TRIGGER trg_${t}_uuid AFTER INSERT ON ${t} WHEN NEW.uuid IS NULL
        BEGIN
          UPDATE ${t} SET uuid = ${SQL_RANDOM_UUID} WHERE id = NEW.id;
        END;
      `);
    }

    db.exec(`INSERT INTO schema_version (version) VALUES (28)`);
  });
  migrate();
}

/**
 * Ballpark densities for aggregates priced by the TON, used to derive
 * a per-CY price for cubic-yard takeoff quantities. Rough
 * loose-material figures -- both the density and the per-CY price are
 * editable per material in the catalog.
 */
export function applyDefaultDensities(db: Database.Database): void {
  db.exec(`
    UPDATE materials SET tons_per_cy = 1.4
      WHERE unit = 'TON' AND tons_per_cy IS NULL AND (
        lower(name) LIKE '%stone%' OR lower(name) LIKE '%gravel%' OR
        lower(name) LIKE '%rip rap%' OR lower(name) LIKE '%riprap%' OR
        lower(name) LIKE '%rock%' OR lower(name) LIKE '%limestone%'
      );
    UPDATE materials SET tons_per_cy = 1.35
      WHERE unit = 'TON' AND tons_per_cy IS NULL AND lower(name) LIKE '%sand%';
    UPDATE materials SET tons_per_cy = 1.3
      WHERE unit = 'TON' AND tons_per_cy IS NULL AND (
        lower(name) LIKE '%fill%' OR lower(name) LIKE '%base%' OR
        lower(name) LIKE '%borrow%'
      );
    UPDATE materials SET cost_per_cy = round(default_unit_cost * tons_per_cy, 2)
      WHERE unit = 'TON' AND cost_per_cy IS NULL
        AND tons_per_cy IS NOT NULL AND default_unit_cost > 0;
  `);
}

// V23: Optional per-CY price (and tons-per-CY density to keep it in
// sync) on TON-priced materials, so cubic-yard trench/takeoff
// quantities are never multiplied by a raw $/TON rate
function migrateV23(db: Database.Database): void {
  db.exec(`
    ALTER TABLE materials ADD COLUMN tons_per_cy REAL;
    ALTER TABLE materials ADD COLUMN cost_per_cy REAL;
  `);
  applyDefaultDensities(db);
  db.exec(`INSERT INTO schema_version (version) VALUES (23);`);
}

function migrateV1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE material_categories (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL UNIQUE,
      description   TEXT
    );

    CREATE TABLE materials (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id       INTEGER NOT NULL REFERENCES material_categories(id),
      name              TEXT NOT NULL,
      description       TEXT,
      unit              TEXT NOT NULL DEFAULT 'EA',
      default_unit_cost REAL NOT NULL DEFAULT 0,
      supplier          TEXT,
      part_number       TEXT,
      last_price_update TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      notes             TEXT,
      is_active         INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX idx_materials_category ON materials(category_id);
    CREATE INDEX idx_materials_name ON materials(name);

    CREATE TABLE labor_roles (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      name                TEXT NOT NULL UNIQUE,
      default_hourly_rate REAL NOT NULL DEFAULT 0,
      burden_multiplier   REAL NOT NULL DEFAULT 1.0,
      notes               TEXT
    );

    CREATE TABLE crew_templates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT
    );

    CREATE TABLE crew_members (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      crew_template_id INTEGER NOT NULL REFERENCES crew_templates(id) ON DELETE CASCADE,
      labor_role_id    INTEGER NOT NULL REFERENCES labor_roles(id),
      quantity         INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX idx_crew_members_template ON crew_members(crew_template_id);

    CREATE TABLE production_rates (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      description      TEXT NOT NULL,
      crew_template_id INTEGER NOT NULL REFERENCES crew_templates(id),
      unit             TEXT NOT NULL DEFAULT 'LF',
      rate_per_hour    REAL NOT NULL DEFAULT 0,
      conditions       TEXT,
      notes            TEXT
    );

    CREATE INDEX idx_production_rates_crew ON production_rates(crew_template_id);

    CREATE TABLE equipment (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL,
      category           TEXT NOT NULL,
      hourly_rate        REAL NOT NULL DEFAULT 0,
      daily_rate         REAL,
      mobilization_cost  REAL NOT NULL DEFAULT 0,
      fuel_cost_per_hour REAL,
      notes              TEXT,
      is_owned           INTEGER NOT NULL DEFAULT 1,
      is_active          INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE jobs (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT NOT NULL,
      job_number       TEXT,
      client           TEXT NOT NULL DEFAULT '',
      location         TEXT,
      bid_date         TEXT,
      start_date       TEXT,
      description      TEXT,
      status           TEXT NOT NULL DEFAULT 'draft'
                       CHECK(status IN ('draft', 'submitted', 'won', 'lost', 'archived')),
      overhead_percent REAL NOT NULL DEFAULT 10.0,
      profit_percent   REAL NOT NULL DEFAULT 10.0,
      bond_percent     REAL DEFAULT 0,
      tax_percent      REAL DEFAULT 0,
      notes            TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX idx_jobs_status ON jobs(status);

    CREATE TABLE bid_sections (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX idx_bid_sections_job ON bid_sections(job_id);

    CREATE TABLE bid_line_items (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      section_id              INTEGER NOT NULL REFERENCES bid_sections(id) ON DELETE CASCADE,
      job_id                  INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      description             TEXT NOT NULL,
      quantity                REAL NOT NULL DEFAULT 0,
      unit                    TEXT NOT NULL DEFAULT 'LF',
      sort_order              INTEGER NOT NULL DEFAULT 0,
      material_id             INTEGER REFERENCES materials(id),
      material_unit_cost      REAL NOT NULL DEFAULT 0,
      material_total          REAL NOT NULL DEFAULT 0,
      crew_template_id        INTEGER REFERENCES crew_templates(id),
      production_rate_id      INTEGER REFERENCES production_rates(id),
      labor_hours             REAL NOT NULL DEFAULT 0,
      labor_cost_per_hour     REAL NOT NULL DEFAULT 0,
      labor_total             REAL NOT NULL DEFAULT 0,
      equipment_cost_per_hour REAL NOT NULL DEFAULT 0,
      equipment_hours         REAL NOT NULL DEFAULT 0,
      equipment_total         REAL NOT NULL DEFAULT 0,
      subcontractor_cost      REAL NOT NULL DEFAULT 0,
      unit_cost               REAL NOT NULL DEFAULT 0,
      total_cost              REAL NOT NULL DEFAULT 0,
      notes                   TEXT
    );

    CREATE INDEX idx_line_items_section ON bid_line_items(section_id);
    CREATE INDEX idx_line_items_job ON bid_line_items(job_id);

    CREATE TABLE price_updates (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
      old_price   REAL NOT NULL,
      new_price   REAL NOT NULL,
      source      TEXT NOT NULL DEFAULT 'Manual',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX idx_price_updates_material ON price_updates(material_id);

    CREATE TABLE app_settings (
      id                       INTEGER PRIMARY KEY CHECK (id = 1),
      company_name             TEXT NOT NULL DEFAULT '',
      company_address          TEXT,
      company_phone            TEXT,
      company_email            TEXT,
      company_logo             TEXT,
      default_overhead_percent REAL NOT NULL DEFAULT 10.0,
      default_profit_percent   REAL NOT NULL DEFAULT 10.0,
      default_tax_percent      REAL NOT NULL DEFAULT 0,
      default_bond_percent     REAL NOT NULL DEFAULT 0,
      setup_complete           INTEGER NOT NULL DEFAULT 0,
      trade_types              TEXT DEFAULT ''
    );

    INSERT INTO app_settings (id, company_name) VALUES (1, '');
    INSERT INTO schema_version (version) VALUES (1);
  `);
}

// V2: Add aliases columns for fuzzy search on all catalog tables
function migrateV2(db: Database.Database): void {
  db.exec(`
    ALTER TABLE materials ADD COLUMN aliases TEXT;
    ALTER TABLE labor_roles ADD COLUMN aliases TEXT;
    ALTER TABLE crew_templates ADD COLUMN aliases TEXT;
    ALTER TABLE production_rates ADD COLUMN aliases TEXT;
    ALTER TABLE equipment ADD COLUMN aliases TEXT;

    INSERT INTO schema_version (version) VALUES (2);
  `);

  // Seed common aliases for standard fittings and items
  const aliasMap: Record<string, string> = {
    // Bends = elbows
    '90° Bend': 'elbow, quarter bend, 90 degree, 90 elbow',
    '45° Bend': 'elbow, eighth bend, 45 degree, 45 elbow',
    // Tees = T junctions
    'Tee': 't junction, t fitting, branch, tee fitting',
    'Wye': 'y fitting, y junction, wye fitting, lateral',
    // Reducers
    'Reducer': 'bushing, reducing coupling, step down',
    // Couplings
    'Coupling': 'union, connector, joiner',
    // Caps
    'Cap': 'end cap, plug, dead end',
    // Valves
    'Gate Valve': 'shutoff valve, isolation valve, gate',
    'Butterfly Valve': 'BFV, throttle valve',
    'Check Valve': 'backflow preventer, non-return valve',
    'Ball Valve': 'shutoff, quarter turn valve',
    // Cleanout
    'Cleanout': 'CO, access point, clean out, sweep',
    // Manholes
    'Manhole': 'MH, access structure, maintenance hole',
    // Hydrants
    'Fire Hydrant': 'FH, hydrant, fire plug',
    // Service materials
    'Corp Stop': 'corporation stop, corp valve, tap valve',
    'Curb Stop': 'curb valve, service valve',
    // Pipe terms
    'SDR-35': 'gravity sewer, sewer pipe',
    'C900': 'pressure pipe, water main pipe',
    'DI Pipe': 'ductile iron, DIP, DI, iron pipe',
    'HDPE': 'poly pipe, polyethylene, PE pipe, fusion pipe',
    // Bedding/backfill
    '#57 Stone': 'number 57, no 57, bedding stone, clean stone',
    'Pea Gravel': 'pea rock, small gravel',
    'Select Fill': 'select backfill, approved fill, borrow',
    'Flowable Fill': 'CLSM, controlled low strength, slurry',
    // Shoring
    'Trench Box': 'trench shield, shoring box, shield',
    // Equipment
    'Excavator': 'trackhoe, track hoe, digger',
    'Backhoe': 'loader backhoe, TLB, rubber tire',
    'Skid Steer': 'bobcat, skid loader, SSL',
    'Compactor': 'tamper, plate tamper, whacker, wacker',
    'Dump Truck': 'haul truck, rock truck',
    'Lowboy': 'low boy, equipment trailer, flatbed',
    // Labor
    'Operator': 'equipment operator, heavy equipment operator, opr',
    'Pipe Layer': 'pipelayer, pipe fitter, pipe man',
    'Laborer': 'helper, general labor, hand',
    'Foreman': 'crew lead, crew leader, supervisor, boss',
    'Teamster': 'truck driver, driver, CDL driver',
    'Pipe Joint Lubricant': 'pipe lube, pipe dope, polyglide, joint lube, gasket lube, gray stuff',
  };

  const updateMat = db.prepare('UPDATE materials SET aliases = ? WHERE name LIKE ?');
  const updateEquip = db.prepare('UPDATE equipment SET aliases = ? WHERE name LIKE ?');
  const updateRole = db.prepare('UPDATE labor_roles SET aliases = ? WHERE name LIKE ?');

  for (const [pattern, aliases] of Object.entries(aliasMap)) {
    updateMat.run(aliases, `%${pattern}%`);
    updateEquip.run(aliases, `%${pattern}%`);
    updateRole.run(aliases, `%${pattern}%`);
  }
}

// V3: Assemblies — reusable material bundles
function migrateV3(db: Database.Database): void {
  db.exec(`
    CREATE TABLE assemblies (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT,
      unit        TEXT NOT NULL DEFAULT 'EA',
      notes       TEXT,
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX idx_assemblies_name ON assemblies(name);

    CREATE TABLE assembly_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      assembly_id INTEGER NOT NULL REFERENCES assemblies(id) ON DELETE CASCADE,
      material_id INTEGER NOT NULL REFERENCES materials(id),
      quantity    REAL NOT NULL DEFAULT 1,
      notes       TEXT
    );

    CREATE INDEX idx_assembly_items_assembly ON assembly_items(assembly_id);

    INSERT INTO schema_version (version) VALUES (3);
  `);
}

// V4: bid_locked column on jobs
function migrateV4(db: Database.Database): void {
  db.exec(`
    ALTER TABLE jobs ADD COLUMN bid_locked INTEGER NOT NULL DEFAULT 0;
    INSERT INTO schema_version (version) VALUES (4);
  `);
}

// V5: auto_lock_on_close setting
function migrateV5(db: Database.Database): void {
  db.exec(`
    ALTER TABLE app_settings ADD COLUMN auto_lock_on_close INTEGER NOT NULL DEFAULT 1;
    INSERT INTO schema_version (version) VALUES (5);
  `);
}

// V6: equipment_id FK on bid_line_items so selected equipment persists when editing
function migrateV6(db: Database.Database): void {
  db.exec(`
    ALTER TABLE bid_line_items ADD COLUMN equipment_id INTEGER REFERENCES equipment(id);
    INSERT INTO schema_version (version) VALUES (6);
  `);
}

// V7: trench_profiles table for per-job underground takeoffs
function migrateV7(db: Database.Database): void {
  db.exec(`
    CREATE TABLE trench_profiles (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id          INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      label           TEXT NOT NULL DEFAULT '',
      pipe_size_in    REAL NOT NULL DEFAULT 8,
      pipe_material   TEXT NOT NULL DEFAULT 'PVC',
      start_depth_ft  REAL NOT NULL DEFAULT 4,
      grade_pct       REAL NOT NULL DEFAULT 2.0,
      run_length_lf   REAL NOT NULL DEFAULT 100,
      trench_width_ft REAL NOT NULL DEFAULT 3,
      bench_width_ft  REAL NOT NULL DEFAULT 0,
      bedding_type    TEXT NOT NULL DEFAULT 'crushed_stone',
      backfill_type   TEXT NOT NULL DEFAULT 'Native Material',
      sort_order      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX idx_trench_profiles_job ON trench_profiles(job_id);

    INSERT INTO schema_version (version) VALUES (7);
  `);
}

function migrateV8(db: Database.Database): void {
  db.exec(`
    ALTER TABLE trench_profiles ADD COLUMN pipe_material_id INTEGER REFERENCES materials(id);
    ALTER TABLE trench_profiles ADD COLUMN bedding_material_id INTEGER REFERENCES materials(id);
    ALTER TABLE trench_profiles ADD COLUMN backfill_material_id INTEGER REFERENCES materials(id);
    ALTER TABLE trench_profiles ADD COLUMN bedding_depth_ft REAL NOT NULL DEFAULT 0.5;

    INSERT INTO schema_version (version) VALUES (8);
  `);
}

// V9: Change orders -- child jobs linked to a parent
function migrateV9(db: Database.Database): void {
  db.exec(`
    ALTER TABLE jobs ADD COLUMN parent_job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE;
    ALTER TABLE jobs ADD COLUMN change_order_number INTEGER;

    CREATE INDEX idx_jobs_parent ON jobs(parent_job_id);

    INSERT INTO schema_version (version) VALUES (9);
  `);
}

// V10: Track last backup schema version for post-migration backup reminders
function migrateV10(db: Database.Database): void {
  db.exec(`
    ALTER TABLE app_settings ADD COLUMN last_backup_schema_version INTEGER NOT NULL DEFAULT 0;

    INSERT INTO schema_version (version) VALUES (10);
  `);
}

// V11: Plan takeoff job settings (scale calibration, PDF path)
function migrateV11(db: Database.Database): void {
  db.exec(`
    CREATE TABLE takeoff_job_settings (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id            INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
      pdf_path          TEXT,
      scale_px_per_ft   REAL,
      scale_point1_x    REAL,
      scale_point1_y    REAL,
      scale_point2_x    REAL,
      scale_point2_y    REAL,
      scale_distance_ft REAL,
      created_at        TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX idx_takeoff_settings_job ON takeoff_job_settings(job_id);

    INSERT INTO schema_version (version) VALUES (11);
  `);
}

function migrateV12(db: Database.Database): void {
  db.exec(`
    CREATE TABLE takeoff_runs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id          INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      label           TEXT NOT NULL DEFAULT '',
      utility_type    TEXT NOT NULL DEFAULT 'sanitary',
      pipe_size_in    REAL NOT NULL DEFAULT 8,
      pipe_material   TEXT NOT NULL DEFAULT 'PVC',
      start_depth_ft  REAL NOT NULL DEFAULT 4,
      grade_pct       REAL NOT NULL DEFAULT 2.0,
      trench_width_ft REAL NOT NULL DEFAULT 3,
      bench_width_ft  REAL NOT NULL DEFAULT 0,
      bedding_type    TEXT NOT NULL DEFAULT '#57 Stone',
      bedding_depth_ft REAL NOT NULL DEFAULT 0.5,
      backfill_type   TEXT NOT NULL DEFAULT 'Native',
      pipe_material_id    INTEGER REFERENCES materials(id),
      bedding_material_id INTEGER REFERENCES materials(id),
      backfill_material_id INTEGER REFERENCES materials(id),
      color           TEXT NOT NULL DEFAULT '#2196F3',
      sort_order      INTEGER NOT NULL DEFAULT 0,
      pdf_page        INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX idx_takeoff_runs_job ON takeoff_runs(job_id);

    CREATE TABLE takeoff_points (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id      INTEGER NOT NULL REFERENCES takeoff_runs(id) ON DELETE CASCADE,
      x_px        REAL NOT NULL,
      y_px        REAL NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX idx_takeoff_points_run ON takeoff_points(run_id);

    INSERT INTO schema_version (version) VALUES (12);
  `);
}

function migrateV13(db: Database.Database): void {
  db.exec(`
    CREATE TABLE takeoff_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      material_id INTEGER REFERENCES materials(id),
      x_px        REAL NOT NULL,
      y_px        REAL NOT NULL,
      quantity    INTEGER NOT NULL DEFAULT 1,
      label       TEXT NOT NULL DEFAULT '',
      pdf_page    INTEGER NOT NULL DEFAULT 1,
      near_run_id INTEGER REFERENCES takeoff_runs(id) ON DELETE SET NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX idx_takeoff_items_job ON takeoff_items(job_id);

    INSERT INTO schema_version (version) VALUES (13);
  `);
}

// V14: Per-page scale calibration (replaces single scale in takeoff_job_settings)
function migrateV14(db: Database.Database): void {
  db.exec(`
    CREATE TABLE takeoff_page_scales (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id          INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      page_number     INTEGER NOT NULL,
      scale_px_per_ft REAL NOT NULL,
      scale_point1_x  REAL,
      scale_point1_y  REAL,
      scale_point2_x  REAL,
      scale_point2_y  REAL,
      scale_distance_ft REAL,
      UNIQUE(job_id, page_number)
    );

    CREATE INDEX idx_takeoff_page_scales_job ON takeoff_page_scales(job_id);

    INSERT INTO schema_version (version) VALUES (14);
  `);
}

// V15: Company tagline for PDF export (replaces hardcoded "Underground Utility Contractor")
function migrateV15(db: Database.Database): void {
  db.exec(`
    ALTER TABLE app_settings ADD COLUMN company_tagline TEXT DEFAULT '';
    INSERT INTO schema_version (version) VALUES (15);
  `);
}

function migrateV16(db: Database.Database): void {
  db.exec(`
    ALTER TABLE takeoff_points ADD COLUMN invert_elev REAL;
    ALTER TABLE takeoff_points ADD COLUMN rim_elev REAL;
    ALTER TABLE takeoff_points ADD COLUMN structure_type TEXT;
    INSERT INTO schema_version (version) VALUES (16);
  `);
}

// V19: Bid alternates and per-section markup overrides
function migrateV19(db: Database.Database): void {
  db.exec(`
    ALTER TABLE bid_sections ADD COLUMN is_alternate INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE bid_sections ADD COLUMN overhead_percent_override REAL;
    ALTER TABLE bid_sections ADD COLUMN profit_percent_override REAL;
    ALTER TABLE bid_sections ADD COLUMN bond_percent_override REAL;
    INSERT INTO schema_version (version) VALUES (19);
  `);
}

// V22: Plan annotations (text notes, arrows, revision clouds)
function migrateV22(db: Database.Database): void {
  db.exec(`
    CREATE TABLE takeoff_annotations (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id    INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      pdf_page  INTEGER NOT NULL DEFAULT 1,
      kind      TEXT NOT NULL DEFAULT 'text',
      x1_px     REAL NOT NULL,
      y1_px     REAL NOT NULL,
      x2_px     REAL,
      y2_px     REAL,
      text      TEXT NOT NULL DEFAULT '',
      color     TEXT NOT NULL DEFAULT '#EF4444',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX idx_takeoff_annotations_job ON takeoff_annotations(job_id);
    INSERT INTO schema_version (version) VALUES (22);
  `);
}

// V21: Tier 2 estimating features — owner item numbers + cost codes on line
// items, subcontractor/supplier quotes, labor+equipment assembly components,
// assembly-driven area takeoff, and job-level material escalation
function migrateV21(db: Database.Database): void {
  db.exec(`
    ALTER TABLE bid_line_items ADD COLUMN item_number TEXT;
    ALTER TABLE bid_line_items ADD COLUMN cost_code TEXT;

    CREATE TABLE quotes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      scope       TEXT NOT NULL DEFAULT '',
      vendor      TEXT NOT NULL DEFAULT '',
      contact     TEXT NOT NULL DEFAULT '',
      amount      REAL NOT NULL DEFAULT 0,
      quote_date  TEXT,
      notes       TEXT,
      is_selected INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX idx_quotes_job ON quotes(job_id);

    ALTER TABLE assemblies ADD COLUMN production_rate_id INTEGER REFERENCES production_rates(id);
    ALTER TABLE assemblies ADD COLUMN crew_template_id INTEGER REFERENCES crew_templates(id);
    ALTER TABLE assemblies ADD COLUMN equipment_id INTEGER REFERENCES equipment(id);
    ALTER TABLE assemblies ADD COLUMN equipment_hours_per_unit REAL NOT NULL DEFAULT 0;

    ALTER TABLE takeoff_areas ADD COLUMN assembly_id INTEGER REFERENCES assemblies(id);

    ALTER TABLE jobs ADD COLUMN escalation_percent REAL NOT NULL DEFAULT 0;

    INSERT INTO schema_version (version) VALUES (21);
  `);
}

// V20: Per-page plan rotation for takeoff
function migrateV20(db: Database.Database): void {
  db.exec(`
    CREATE TABLE takeoff_page_rotations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      page_number INTEGER NOT NULL,
      rotation    INTEGER NOT NULL DEFAULT 0,
      UNIQUE(job_id, page_number)
    );
    CREATE INDEX idx_takeoff_page_rotations_job ON takeoff_page_rotations(job_id);
    INSERT INTO schema_version (version) VALUES (20);
  `);
}

// V18: Area takeoff (surface restoration polygons: asphalt, concrete, gravel)
function migrateV18(db: Database.Database): void {
  db.exec(`
    CREATE TABLE takeoff_areas (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      label       TEXT NOT NULL DEFAULT '',
      area_type   TEXT NOT NULL DEFAULT 'asphalt',
      depth_ft    REAL NOT NULL DEFAULT 0,
      material_id INTEGER REFERENCES materials(id),
      color       TEXT NOT NULL DEFAULT '#455A64',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      pdf_page    INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX idx_takeoff_areas_job ON takeoff_areas(job_id);

    CREATE TABLE takeoff_area_points (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      area_id     INTEGER NOT NULL REFERENCES takeoff_areas(id) ON DELETE CASCADE,
      x_px        REAL NOT NULL,
      y_px        REAL NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_takeoff_area_points_area ON takeoff_area_points(area_id);

    INSERT INTO schema_version (version) VALUES (18);
  `);
}

// V24: Cloud sync (Phase 3) -- per-job cloud identity + sync state, and a
// single-row table holding the signed-in cloud session (refresh token is
// encrypted with Electron safeStorage before it lands here).
//
// Written defensively: a pre-merge build shipped this same DDL under
// version 23 (which mainline used for the materials per-CY columns), so a
// database can arrive here already having the cloud tables, the materials
// columns, neither, or one of each. Each piece is applied only if missing.
function migrateV24(db: Database.Database): void {
  const hasColumn = (table: string, column: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
      (c) => c.name === column
    );

  // Heal databases whose version-23 slot was the cloud DDL instead of the
  // materials per-CY pricing columns.
  if (!hasColumn('materials', 'tons_per_cy')) {
    db.exec(`
      ALTER TABLE materials ADD COLUMN tons_per_cy REAL;
      ALTER TABLE materials ADD COLUMN cost_per_cy REAL;
    `);
    applyDefaultDensities(db);
  }

  if (!hasColumn('jobs', 'cloud_id')) {
    db.exec(`ALTER TABLE jobs ADD COLUMN cloud_id TEXT;`);
  }

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_cloud_id ON jobs(cloud_id) WHERE cloud_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS cloud_sync_state (
      job_id           INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
      enabled          INTEGER NOT NULL DEFAULT 1,
      -- Hash of this machine's serialization at the last successful sync
      -- (detects local edits) vs. the hash the cloud currently advertises
      -- (detects remote edits). They differ after a pull because local row
      -- ids change on import.
      last_hash_local  TEXT,
      last_hash_remote TEXT,
      plan_hash        TEXT,
      status           TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'synced', 'conflict', 'error')),
      error            TEXT,
      last_synced_at   TEXT
    );

    CREATE TABLE IF NOT EXISTS cloud_auth (
      id                INTEGER PRIMARY KEY CHECK (id = 1),
      email             TEXT,
      user_id           TEXT,
      account_id        TEXT,
      refresh_token_enc TEXT,
      updated_at        TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    INSERT INTO schema_version (version) VALUES (24);
  `);
}

function migrateV26(db: Database.Database): void {
  // Marks rows inserted by the setup wizard's sample catalog, so a future
  // "Remove sample items" action can delete unreferenced seed rows. Rows
  // seeded before this migration stay unflagged (default 0) — flagging by
  // name-matching could mark user-curated rows for deletion later.
  db.exec(`
    ALTER TABLE material_categories ADD COLUMN is_seed INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE materials ADD COLUMN is_seed INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE labor_roles ADD COLUMN is_seed INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE equipment ADD COLUMN is_seed INTEGER NOT NULL DEFAULT 0;
    INSERT INTO schema_version (version) VALUES (26);
  `);
}

function migrateV27(db: Database.Database): void {
  // Encrypted cloud backup state. backup_salt (hex) + backup_key_enc
  // (safeStorage-wrapped passphrase-derived key) make backups automatic on
  // this machine without re-prompting; the salt also rides in the uploaded
  // file's header so a fresh machine can re-derive the key from the
  // passphrase alone. The passphrase itself is never stored anywhere.
  //
  // SUPERSEDED: backups now ride the E2EE DEK, and the passphrase scheme this
  // describes is gone (backup-crypto.ts was deleted once it had no callers).
  // backup_salt/backup_key_enc are dead columns kept only because migrations
  // are forward-only; backup_last_at survives as a display fallback. The text
  // above is left as-is because it explains why the columns exist.
  db.exec(`
    ALTER TABLE cloud_auth ADD COLUMN backup_salt TEXT;
    ALTER TABLE cloud_auth ADD COLUMN backup_key_enc TEXT;
    ALTER TABLE cloud_auth ADD COLUMN backup_last_at TEXT;
    ALTER TABLE cloud_auth ADD COLUMN backup_last_hash TEXT;
    INSERT INTO schema_version (version) VALUES (27);
  `);
}

function migrateV25(db: Database.Database): void {
  // Local-only mode: user opted out of cloud sync entirely. When set, the
  // main process never constructs the cloud auth/sync modules, so the app
  // makes no network requests beyond the GitHub update check.
  db.exec(`
    ALTER TABLE app_settings ADD COLUMN local_only_mode INTEGER NOT NULL DEFAULT 0;
    INSERT INTO schema_version (version) VALUES (25);
  `);
}

function migrateV17(db: Database.Database): void {
  db.exec(`
    CREATE TABLE takeoff_nodes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id          INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      x_px            REAL NOT NULL,
      y_px            REAL NOT NULL,
      pdf_page        INTEGER NOT NULL DEFAULT 1,
      invert_elev     REAL,
      rim_elev        REAL,
      structure_type  TEXT,
      label           TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX idx_takeoff_nodes_job ON takeoff_nodes(job_id);
    ALTER TABLE takeoff_points ADD COLUMN node_id INTEGER REFERENCES takeoff_nodes(id) ON DELETE SET NULL;
    INSERT INTO schema_version (version) VALUES (17);
  `);
}
