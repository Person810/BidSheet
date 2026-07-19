import { describe, it, expect, vi } from 'vitest';

// database.ts only touches electron for getDbPath(); tests always pass an
// explicit path, so a stub app is enough to load the module under node.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));

import type Database from 'better-sqlite3';
import { initializeDatabase, seedUuid, UUID_TABLES } from '../database';
import { exportJob, importJob, JobSnapshot } from './serializer';
import { validateSnapshot } from './validate-snapshot';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function freshDb(): Database.Database {
  return initializeDatabase(':memory:');
}

const lastId = (info: { lastInsertRowid: number | bigint }) => Number(info.lastInsertRowid);
const uuidOf = (db: Database.Database, table: string, id: number): string =>
  (db.prepare(`SELECT uuid FROM ${table} WHERE id = ?`).get(id) as any).uuid;

/** A job exercising every catalog FK the serializer translates. */
function buildFixture(db: Database.Database) {
  const catId = lastId(db.prepare("INSERT INTO material_categories (name) VALUES ('Pipe')").run());
  const matId = lastId(
    db
      .prepare("INSERT INTO materials (category_id, name, unit, default_unit_cost) VALUES (?, '8\" PVC SDR-35', 'LF', 12.5)")
      .run(catId)
  );
  const equipId = lastId(
    db.prepare("INSERT INTO equipment (name, category, hourly_rate) VALUES ('Excavator', 'Heavy', 150)").run()
  );
  const asmId = lastId(db.prepare("INSERT INTO assemblies (name) VALUES ('Sidewalk demo + pour')").run());

  const clientId = lastId(
    db.prepare("INSERT INTO clients (name, contact_name) VALUES ('Smith Construction', 'Bob')").run()
  );
  const jobId = lastId(
    db
      .prepare("INSERT INTO jobs (name, client, client_id) VALUES ('Elm Street Sewer', 'Smith Construction', ?)")
      .run(clientId)
  );
  const sectionId = lastId(
    db.prepare("INSERT INTO bid_sections (job_id, name) VALUES (?, 'Base Bid')").run(jobId)
  );
  db.prepare(
    `INSERT INTO bid_line_items (job_id, section_id, description, material_id, equipment_id)
     VALUES (?, ?, '8 inch main', ?, ?)`
  ).run(jobId, sectionId, matId, equipId);
  db.prepare('INSERT INTO trench_profiles (job_id, pipe_material_id) VALUES (?, ?)').run(jobId, matId);
  db.prepare('INSERT INTO takeoff_runs (job_id, pipe_material_id) VALUES (?, ?)').run(jobId, matId);
  db.prepare('INSERT INTO takeoff_items (job_id, material_id, x_px, y_px) VALUES (?, ?, 10, 20)').run(
    jobId,
    matId
  );
  db.prepare(
    'INSERT INTO takeoff_areas (job_id, material_id, assembly_id, grade_mode, grade_value_ft) VALUES (?, ?, ?, ?, ?)'
  ).run(jobId, matId, asmId, 'finished_elev', 98.5);
  // Existing-grade surface with two spot elevations
  const surfaceId = lastId(
    db.prepare("INSERT INTO takeoff_surfaces (job_id, kind, name) VALUES (?, 'existing', 'Existing Grade')").run(jobId)
  );
  db.prepare('INSERT INTO takeoff_surface_points (surface_id, x, y, z_ft, pdf_page, sort_order) VALUES (?, 1, 2, 100.5, 1, 0)').run(surfaceId);
  db.prepare('INSERT INTO takeoff_surface_points (surface_id, x, y, z_ft, pdf_page, sort_order) VALUES (?, 3, 4, 101.25, 1, 1)').run(surfaceId);
  return { jobId, matId, equipId, asmId, surfaceId, clientId };
}

describe('v28 uuid migration', () => {
  it('gives every uuid table a populated, unique uuid via trigger', () => {
    const db = freshDb();
    const { matId } = buildFixture(db);
    expect(uuidOf(db, 'materials', matId)).toMatch(UUID_RE);
    for (const t of UUID_TABLES) {
      const missing = db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE uuid IS NULL`).get() as any;
      expect(missing.n).toBe(0);
    }
  });

  it('derives the same seed uuid on every install', () => {
    expect(seedUuid('materials', 'Pipe/8" PVC SDR-35')).toBe(seedUuid('materials', 'Pipe/8" PVC SDR-35'));
    expect(seedUuid('materials', 'Pipe/8" PVC SDR-35')).toMatch(UUID_RE);
    expect(seedUuid('materials', 'a')).not.toBe(seedUuid('equipment', 'a'));
  });
});

describe('exportJob (format 2)', () => {
  it('replaces catalog integer refs with stable uuids and passes validation', () => {
    const db = freshDb();
    const { jobId, matId, asmId } = buildFixture(db);
    const snap = exportJob(db, jobId);

    expect(snap.format).toBe(2);
    expect(() => validateSnapshot(snap)).not.toThrow();

    const matUuid = uuidOf(db, 'materials', matId);
    expect(snap.line_items[0].material_uuid).toBe(matUuid);
    expect(snap.line_items[0].material_id).toBeUndefined();
    expect(snap.trench_profiles[0].pipe_material_uuid).toBe(matUuid);
    expect(snap.takeoff.runs[0].pipe_material_uuid).toBe(matUuid);
    expect(snap.takeoff.items[0].material_uuid).toBe(matUuid);
    expect(snap.takeoff.areas[0].assembly_uuid).toBe(uuidOf(db, 'assemblies', asmId));
    // Earthwork grade columns ride along on the area row
    expect(snap.takeoff.areas[0].grade_mode).toBe('finished_elev');
    expect(snap.takeoff.areas[0].grade_value_ft).toBe(98.5);
    // Existing-grade surface + its spot elevations are captured
    expect(snap.takeoff.surfaces).toHaveLength(1);
    expect(snap.takeoff.surface_points).toHaveLength(2);
    expect(snap.takeoff.surface_points[0].z_ft).toBe(100.5);
  });

  it('replaces the client link with the client row uuid', () => {
    const db = freshDb();
    const { jobId, clientId } = buildFixture(db);
    const snap = exportJob(db, jobId);
    expect(snap.job.client_uuid).toBe(uuidOf(db, 'clients', clientId));
    expect(snap.job.client_id).toBeUndefined();
    expect(snap.job.client).toBe('Smith Construction');
  });
});

describe('importJob (format 2)', () => {
  /** Export from machine A, import into machine B whose integer ids differ. */
  function exportAndImport() {
    const a = freshDb();
    const fixture = buildFixture(a);
    const snap = exportJob(a, fixture.jobId);

    const b = freshDb();
    // Skew B's AUTOINCREMENT ids so integer-id reuse would visibly break.
    const catId = lastId(b.prepare("INSERT INTO material_categories (name) VALUES ('Pipe')").run());
    for (let i = 0; i < 5; i++) {
      b.prepare("INSERT INTO materials (category_id, name, unit) VALUES (?, 'filler', 'EA')").run(catId);
    }
    const bMatId = lastId(
      b
        .prepare("INSERT INTO materials (category_id, name, unit, uuid) VALUES (?, '8\" PVC SDR-35', 'LF', ?)")
        .run(catId, uuidOf(a, 'materials', fixture.matId))
    );
    // Equipment + assembly deliberately absent from B.
    return { a, b, snap, bMatId };
  }

  it('resolves catalog uuids to the local integer ids', () => {
    const { b, snap, bMatId } = exportAndImport();
    const result = importJob(b, 'cloud-job-1', snap);

    const li = b.prepare('SELECT * FROM bid_line_items WHERE job_id = ?').get(result.jobId) as any;
    expect(li.material_id).toBe(bMatId);
    const run = b.prepare('SELECT * FROM takeoff_runs WHERE job_id = ?').get(result.jobId) as any;
    expect(run.pipe_material_id).toBe(bMatId);
  });

  it('round-trips existing-grade surfaces and earthwork grade columns', () => {
    const { b, snap } = exportAndImport();
    const result = importJob(b, 'cloud-job-1', snap);

    const surface = b.prepare('SELECT * FROM takeoff_surfaces WHERE job_id = ?').get(result.jobId) as any;
    expect(surface.kind).toBe('existing');
    const pts = b.prepare(
      'SELECT z_ft FROM takeoff_surface_points WHERE surface_id = ? ORDER BY sort_order'
    ).all(surface.id) as any[];
    expect(pts.map((p) => p.z_ft)).toEqual([100.5, 101.25]);

    const area = b.prepare('SELECT * FROM takeoff_areas WHERE job_id = ?').get(result.jobId) as any;
    expect(area.grade_mode).toBe('finished_elev');
    expect(area.grade_value_ft).toBe(98.5);
  });

  it('nulls and counts refs whose uuid is not in the local catalog', () => {
    const { b, snap } = exportAndImport();
    const result = importJob(b, 'cloud-job-1', snap);

    // equipment (line item) + assembly (area) are missing on B
    expect(result.droppedCatalogRefs).toBe(2);
    const li = b.prepare('SELECT * FROM bid_line_items WHERE job_id = ?').get(result.jobId) as any;
    expect(li.equipment_id).toBeNull();
    const area = b.prepare('SELECT * FROM takeoff_areas WHERE job_id = ?').get(result.jobId) as any;
    expect(area.assembly_id).toBeNull();
  });

  it('resolves the client by uuid when the record already synced', () => {
    const { b, snap } = exportAndImport();
    const bClientId = lastId(
      b.prepare("INSERT INTO clients (name, uuid) VALUES ('Smith Construction', ?)").run(snap.job.client_uuid)
    );
    const result = importJob(b, 'cloud-job-1', snap);
    const job = b.prepare('SELECT * FROM jobs WHERE id = ?').get(result.jobId) as any;
    expect(job.client_id).toBe(bClientId);
  });

  it('falls back to a same-named local client when the uuid is unknown', () => {
    const { b, snap } = exportAndImport();
    const bClientId = lastId(
      b.prepare("INSERT INTO clients (name) VALUES ('smith construction')").run()
    );
    const result = importJob(b, 'cloud-job-1', snap);
    const job = b.prepare('SELECT * FROM jobs WHERE id = ?').get(result.jobId) as any;
    expect(job.client_id).toBe(bClientId);
  });

  it('creates a stub client carrying the remote uuid when nothing matches', () => {
    const { b, snap } = exportAndImport();
    const result = importJob(b, 'cloud-job-1', snap);
    const job = b.prepare('SELECT * FROM jobs WHERE id = ?').get(result.jobId) as any;
    expect(job.client_id).not.toBeNull();
    const client = b.prepare('SELECT * FROM clients WHERE id = ?').get(job.client_id) as any;
    expect(client.name).toBe('Smith Construction');
    // The stub adopts the remote uuid, so the later catalog pull merges the
    // full record onto this same row instead of duplicating the client.
    expect(client.uuid).toBe(snap.job.client_uuid);
  });

  it('keeps row uuids stable across machines', () => {
    const { b, snap } = exportAndImport();
    const result = importJob(b, 'cloud-job-1', snap);
    const li = b.prepare('SELECT uuid FROM bid_line_items WHERE job_id = ?').get(result.jobId) as any;
    expect(li.uuid).toBe(snap.line_items[0].uuid);
  });

  it('re-importing the same job replaces children without uuid conflicts', () => {
    const { b, snap } = exportAndImport();
    const first = importJob(b, 'cloud-job-1', snap);
    const again = importJob(b, 'cloud-job-1', snap);
    expect(again.jobId).toBe(first.jobId);
    const count = b.prepare('SELECT COUNT(*) AS n FROM bid_line_items WHERE job_id = ?').get(first.jobId) as any;
    expect(count.n).toBe(1);
  });

  it('assigns fresh uuids when the same snapshot lands as a different job', () => {
    const { b, snap } = exportAndImport();
    const first = importJob(b, 'cloud-job-1', snap);
    const second = importJob(b, 'cloud-job-2', snap); // same rows, new job
    expect(second.jobId).not.toBe(first.jobId);
    const u1 = (b.prepare('SELECT uuid FROM bid_line_items WHERE job_id = ?').get(first.jobId) as any).uuid;
    const u2 = (b.prepare('SELECT uuid FROM bid_line_items WHERE job_id = ?').get(second.jobId) as any).uuid;
    expect(u2).not.toBe(u1);
    expect(u2).toMatch(UUID_RE);
  });

  it('still imports legacy format-1 snapshots with integer-id semantics', () => {
    const db = freshDb();
    const { matId } = buildFixture(db);
    const legacy: JobSnapshot = {
      format: 1,
      job: { name: 'Old Client Job' },
      sections: [{ id: 7, name: 'Base Bid' }],
      line_items: [
        { id: 1, section_id: 7, description: 'kept ref', material_id: matId },
        { id: 2, section_id: 7, description: 'dangling ref', material_id: 9999 },
      ],
      trench_profiles: [],
      quotes: [],
      takeoff: {
        settings: null, page_scales: [], page_rotations: [], nodes: [], runs: [],
        points: [], items: [], areas: [], area_points: [], annotations: [],
      },
      plan: null,
    };
    const result = importJob(db, 'legacy-1', legacy);
    const items = db
      .prepare('SELECT * FROM bid_line_items WHERE job_id = ? ORDER BY id')
      .all(result.jobId) as any[];
    expect(items[0].material_id).toBe(matId);
    expect(items[1].material_id).toBeNull();
    expect(result.droppedCatalogRefs).toBe(1);
  });
});

describe('importJob fuzzing (the import path is a security boundary)', () => {
  // Deterministic PRNG so a failure reproduces.
  function mulberry32(seed: number) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const GARBAGE = [
    null, undefined, NaN, Infinity, -Infinity, 0, -1, 1.5, 1e308, '', 'x'.repeat(300_000),
    [], {}, { nested: { deep: true } }, [[[[[[1]]]]]], true, false,
    '../../../etc/passwd', "'; DROP TABLE jobs; --",
  ];

  function collectSlots(value: any, out: { parent: any; key: string | number }[] = []) {
    if (Array.isArray(value)) {
      value.forEach((v, i) => {
        out.push({ parent: value, key: i });
        collectSlots(v, out);
      });
    } else if (value !== null && typeof value === 'object') {
      for (const k of Object.keys(value)) {
        out.push({ parent: value, key: k });
        collectSlots(value[k], out);
      }
    }
    return out;
  }

  const countRows = (db: Database.Database) =>
    ['jobs', 'bid_sections', 'bid_line_items', 'takeoff_runs', 'takeoff_items', 'takeoff_areas']
      .map((t) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n)
      .join(',');

  it('rejects plain garbage outright', () => {
    const db = freshDb();
    buildFixture(db);
    const before = countRows(db);
    for (const g of GARBAGE) {
      expect(() => importJob(db, 'garbage', g as any)).toThrow();
    }
    expect(countRows(db)).toBe(before);
  });

  it('never partially imports a mutated snapshot (150 seeded mutations)', () => {
    const source = freshDb();
    const { jobId } = buildFixture(source);
    const pristine = exportJob(source, jobId);

    const db = freshDb();
    buildFixture(db);
    const rand = mulberry32(20260612);
    const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

    let accepted = 0;
    let rejected = 0;
    for (let i = 0; i < 150; i++) {
      const snap = JSON.parse(JSON.stringify(pristine));
      const ops = 1 + Math.floor(rand() * 3);
      for (let o = 0; o < ops; o++) {
        const slots = collectSlots(snap);
        const slot = pick(slots);
        const action = rand();
        if (action < 0.5) {
          slot.parent[slot.key] = pick(GARBAGE);
        } else if (action < 0.75 && typeof slot.key === 'string') {
          delete slot.parent[slot.key];
        } else if (typeof slot.parent === 'object' && !Array.isArray(slot.parent)) {
          slot.parent[pick(['evil_key', 'uuid', 'id', 'job_id'])] = pick(GARBAGE);
        }
      }

      const before = countRows(db);
      try {
        importJob(db, `fuzz-${i}`, snap);
        accepted++;
      } catch {
        rejected++;
        // crash-only: a rejected snapshot writes nothing
        expect(countRows(db)).toBe(before);
      }
    }

    // The mutator must actually exercise both sides of the boundary.
    expect(rejected).toBeGreaterThan(20);
    expect(accepted).toBeGreaterThan(5);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    // And the import path still works after the abuse.
    expect(() => importJob(db, 'post-fuzz', pristine)).not.toThrow();
  });
});
