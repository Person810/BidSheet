import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

import type Database from 'better-sqlite3';
import { initializeDatabase } from '../database';
import { exportCatalog, importCatalog, catalogHash, CatalogSnapshot } from './catalog-sync';

function freshDb(): Database.Database {
  return initializeDatabase(':memory:');
}

const lastId = (info: { lastInsertRowid: number | bigint }) => Number(info.lastInsertRowid);

/** A small but complete catalog: every synced table populated, FKs wired. */
function buildCatalog(db: Database.Database) {
  const catId = lastId(db.prepare("INSERT INTO material_categories (name) VALUES ('Pipe')").run());
  const matId = lastId(
    db
      .prepare(
        "INSERT INTO materials (category_id, name, unit, default_unit_cost) VALUES (?, '8\" PVC SDR-35', 'LF', 12.5)"
      )
      .run(catId)
  );
  const roleId = lastId(
    db.prepare("INSERT INTO labor_roles (name, default_hourly_rate) VALUES ('Operator', 45)").run()
  );
  db.prepare("INSERT INTO equipment (name, category, hourly_rate) VALUES ('Excavator', 'Heavy', 150)").run();
  const crewId = lastId(db.prepare("INSERT INTO crew_templates (name) VALUES ('Pipe crew')").run());
  db.prepare('INSERT INTO crew_members (crew_template_id, labor_role_id, quantity) VALUES (?, ?, 2)').run(
    crewId,
    roleId
  );
  db.prepare(
    "INSERT INTO production_rates (description, crew_template_id, unit, rate_per_hour) VALUES ('8\" main in good soil', ?, 'LF', 30)"
  ).run(crewId);
  const asmId = lastId(db.prepare("INSERT INTO assemblies (name) VALUES ('Pipe + bedding')").run());
  db.prepare('INSERT INTO assembly_items (assembly_id, material_id, quantity) VALUES (?, ?, 1)').run(
    asmId,
    matId
  );
  db.prepare("UPDATE app_settings SET company_name = 'Dirt Bros LLC', default_overhead_percent = 12 WHERE id = 1").run();
  const clientId = lastId(
    db
      .prepare("INSERT INTO clients (name, address, contact_name) VALUES ('Smith Construction', '12 Main St', 'Bob')")
      .run()
  );
  return { catId, matId, roleId, crewId, asmId, clientId };
}

describe('exportCatalog', () => {
  it('exports every table keyed by uuid with no integer ids or FK ids', () => {
    const db = freshDb();
    buildCatalog(db);
    const snap = exportCatalog(db);

    expect(snap.materials).toHaveLength(1);
    expect(snap.materials[0].id).toBeUndefined();
    expect(snap.materials[0].uuid).toBeTruthy();
    expect(snap.materials[0].category_id).toBeUndefined();
    expect(snap.materials[0].category_uuid).toBe(snap.material_categories[0].uuid);
    expect(snap.production_rates[0].crew_template_uuid).toBe(snap.crew_templates[0].uuid);
    expect(snap.assembly_items[0].assembly_uuid).toBe(snap.assemblies[0].uuid);
    expect(snap.assembly_items[0].material_uuid).toBe(snap.materials[0].uuid);
    expect(snap.crew_members[0]).toEqual({
      crew_template_uuid: snap.crew_templates[0].uuid,
      labor_role_uuid: snap.labor_roles[0].uuid,
      quantity: 2,
    });
    expect(snap.settings?.company_name).toBe('Dirt Bros LLC');
    // machine-local settings never travel
    expect(snap.settings?.setup_complete).toBeUndefined();
    expect(snap.settings?.local_only_mode).toBeUndefined();
    // client records ride along with the catalog (#94)
    expect(snap.clients).toHaveLength(1);
    expect(snap.clients![0].id).toBeUndefined();
    expect(snap.clients![0].uuid).toBeTruthy();
    expect(snap.clients![0].contact_name).toBe('Bob');
  });

  it('hashes deterministically, ignoring volatile metadata', () => {
    const db = freshDb();
    buildCatalog(db);
    const a = exportCatalog(db);
    const b = exportCatalog(db);
    expect(catalogHash(a)).toBe(catalogHash(b));
    b.pushed_at = '2026-06-12T00:00:00Z';
    b.app_version = '9.9.9';
    expect(catalogHash(b)).toBe(catalogHash(a));
  });
});

describe('importCatalog', () => {
  it('merges a full catalog into an empty machine and converges (hash equality)', () => {
    const a = freshDb();
    buildCatalog(a);
    const snap = exportCatalog(a);

    const b = freshDb();
    const result = importCatalog(b, snap);
    expect(result.skipped).toBe(0);
    expect(result.applied).toBeGreaterThan(0);

    // The whole point: after a pull into a clean machine, both serialize
    // identically — no push loop, and FKs resolved to B's own ids.
    expect(catalogHash(exportCatalog(b))).toBe(catalogHash(snap));
    const mat = b.prepare('SELECT * FROM materials').get() as any;
    const cat = b.prepare('SELECT * FROM material_categories').get() as any;
    expect(mat.category_id).toBe(cat.id);
    expect(b.prepare('SELECT company_name FROM app_settings WHERE id = 1').get()).toEqual({
      company_name: 'Dirt Bros LLC',
    });
  });

  it('accepts snapshots from pre-clients builds (clients key absent)', () => {
    const a = freshDb();
    buildCatalog(a);
    const snap = exportCatalog(a) as any;
    delete snap.clients;
    const b = freshDb();
    expect(() => importCatalog(b, snap)).not.toThrow();
    expect((b.prepare('SELECT COUNT(*) AS n FROM clients').get() as any).n).toBe(0);
  });

  it('is idempotent — re-importing an identical catalog applies nothing', () => {
    const a = freshDb();
    buildCatalog(a);
    const snap = exportCatalog(a);
    const b = freshDb();
    importCatalog(b, snap);
    const again = importCatalog(b, snap);
    expect(again.applied).toBe(0);
    expect(again.skipped).toBe(0);
  });

  it('updates rows by uuid (remote price edit wins) and keeps local-only rows', () => {
    const a = freshDb();
    buildCatalog(a);
    const snap = exportCatalog(a);

    const b = freshDb();
    importCatalog(b, snap);
    // local-only addition on B
    const bCatId = (b.prepare('SELECT id FROM material_categories').get() as any).id;
    b.prepare("INSERT INTO materials (category_id, name, unit) VALUES (?, 'Local-only item', 'EA')").run(bCatId);

    // remote price change
    const edited = JSON.parse(JSON.stringify(snap)) as CatalogSnapshot;
    edited.materials[0].default_unit_cost = 14.75;
    const result = importCatalog(b, edited);
    expect(result.applied).toBe(1);

    const rows = b.prepare('SELECT name, default_unit_cost FROM materials ORDER BY id').all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].default_unit_cost).toBe(14.75);
    expect(rows[1].name).toBe('Local-only item');
  });

  it('propagates soft deletes as updates', () => {
    const a = freshDb();
    buildCatalog(a);
    a.prepare('UPDATE materials SET is_active = 0').run();
    const snap = exportCatalog(a);

    const b = freshDb();
    importCatalog(b, snap);
    expect((b.prepare('SELECT is_active FROM materials').get() as any).is_active).toBe(0);
  });

  it('replaces crew composition wholesale when it changed', () => {
    const a = freshDb();
    const { crewId, roleId } = buildCatalog(a);
    const snapBefore = exportCatalog(a);

    const b = freshDb();
    importCatalog(b, snapBefore);

    // A changes the crew: operator count 2 → 3 plus a new laborer role
    const laborerId = lastId(
      a.prepare("INSERT INTO labor_roles (name, default_hourly_rate) VALUES ('Laborer', 28)").run()
    );
    a.prepare('UPDATE crew_members SET quantity = 3 WHERE crew_template_id = ? AND labor_role_id = ?').run(
      crewId,
      roleId
    );
    a.prepare('INSERT INTO crew_members (crew_template_id, labor_role_id, quantity) VALUES (?, ?, 1)').run(
      crewId,
      laborerId
    );
    importCatalog(b, exportCatalog(a));

    const members = b
      .prepare(
        `SELECT lr.name, cm.quantity FROM crew_members cm
         JOIN labor_roles lr ON lr.id = cm.labor_role_id ORDER BY lr.name`
      )
      .all() as any[];
    expect(members).toEqual([
      { name: 'Laborer', quantity: 1 },
      { name: 'Operator', quantity: 3 },
    ]);
  });

  it('skips (never invents) children whose parent uuid is unresolvable', () => {
    const a = freshDb();
    buildCatalog(a);
    const snap = exportCatalog(a);
    snap.materials[0].category_uuid = '00000000-0000-0000-0000-000000000000';

    const b = freshDb();
    const result = importCatalog(b, snap);
    expect(result.skipped).toBeGreaterThan(0);
    expect((b.prepare('SELECT COUNT(*) AS n FROM materials').get() as any).n).toBe(0);
  });

  it('rejects malformed catalogs outright (untrusted input boundary)', () => {
    const db = freshDb();
    for (const garbage of [null, 42, [], {}, { format: 1 }]) {
      expect(() => importCatalog(db, garbage)).toThrow();
    }
    const a = freshDb();
    buildCatalog(a);
    const polluted: any = JSON.parse(JSON.stringify(exportCatalog(a)));
    polluted.materials[0] = JSON.parse('{"uuid": "x", "__proto__": {"polluted": true}}');
    expect(() => importCatalog(db, polluted)).toThrow(/forbidden key/);
  });
});
