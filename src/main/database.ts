import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import { TRADE_SEED_DATA, TradeType } from '../shared/constants/seed-data';

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
  companyName: string
): void {
  const seed = db.transaction(() => {
    const categoryMap = new Map<string, string>();
    const allMaterials: { category: string; name: string; unit: string; price: number; description?: string }[] = [];
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

    const insertCat = db.prepare(
      'INSERT OR IGNORE INTO material_categories (name, description) VALUES (?, ?)'
    );
    for (const [name, desc] of categoryMap) {
      insertCat.run(name, desc);
    }

    const catRows = db.prepare('SELECT id, name FROM material_categories').all() as { id: number; name: string }[];
    const catIdByName = new Map(catRows.map((r) => [r.name, r.id]));

    const insertMat = db.prepare(
      'INSERT INTO materials (category_id, name, description, unit, default_unit_cost) VALUES (?, ?, ?, ?, ?)'
    );
    for (const mat of allMaterials) {
      const catId = catIdByName.get(mat.category);
      if (catId) {
        insertMat.run(catId, mat.name, mat.description || null, mat.unit, mat.price);
      }
    }

    const insertRole = db.prepare(
      'INSERT OR IGNORE INTO labor_roles (name, default_hourly_rate, burden_multiplier, notes) VALUES (?, ?, ?, ?)'
    );
    for (const [name, role] of laborMap) {
      insertRole.run(name, role.rate, role.burden, role.notes);
    }

    const insertEquip = db.prepare(
      'INSERT OR IGNORE INTO equipment (name, category, hourly_rate, mobilization_cost, is_owned, notes) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const [name, equip] of equipmentMap) {
      insertEquip.run(name, equip.category, equip.hourlyRate, equip.mobilization, equip.isOwned ? 1 : 0, equip.notes);
    }

    // Get current schema version to suppress backup reminder on fresh installs
    const schemaVersion = (db.prepare('SELECT MAX(version) as v FROM schema_version').get() as any)?.v ?? 0;

    db.prepare(
      'UPDATE app_settings SET setup_complete = 1, company_name = ?, trade_types = ?, last_backup_schema_version = ? WHERE id = 1'
    ).run(companyName, trades.join(','), schemaVersion);
  });

  seed();
}

function runMigrations(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');

  const currentVersion = db.prepare(
    'SELECT MAX(version) as version FROM schema_version'
  ).get() as { version: number | null };

  const version = currentVersion?.version ?? 0;

  if (version < 1) {
    migrateV1(db);
  }
  if (version < 2) {
    migrateV2(db);
  }
  if (version < 3) {
    migrateV3(db);
  }
  if (version < 4) {
    migrateV4(db);
  }
  if (version < 5) {
    migrateV5(db);
  }
  if (version < 6) {
    migrateV6(db);
  }
  if (version < 7) {
    migrateV7(db);
  }
  if (version < 8) {
    migrateV8(db);
  }
  if (version < 9) {
    migrateV9(db);
  }
  if (version < 10) {
    migrateV10(db);
  }
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
