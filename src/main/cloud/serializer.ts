/**
 * Job snapshot serializer for cloud sync (Phase 3).
 *
 * exportJob() turns one job and everything hanging off it (bid sections,
 * line items, takeoff geometry, trench profiles, quotes) into a single JSON
 * document the sync engine pushes as job.json. importJob() does the
 * reverse: upserts the snapshot into the local database, remapping row ids
 * (local ids are AUTOINCREMENT integers and differ across machines).
 *
 * Catalog references (materials, crews, equipment, assemblies, production
 * rates) are NOT synced in Phase 3 — line items carry denormalized costs, so
 * bids stay intact on another machine; a catalog FK is kept when a local row
 * with that id exists (same-machine round trip) and nulled otherwise.
 *
 * Hashing: snapshotHash() is a sha256 of the stably-stringified document
 * minus volatile metadata (pushed_at, app_version). Row ids ARE part of the
 * hash, which is why the sync engine tracks a local and a remote hash
 * separately — ids shift on import, the content doesn't.
 */

import crypto from 'crypto';
import type Database from 'better-sqlite3';

export interface PlanRef {
  filename: string;
  sha256: string;
  size_bytes: number;
}

export interface JobSnapshot {
  format: 1;
  pushed_at?: string;
  app_version?: string;
  job: Record<string, any>;
  sections: any[];
  line_items: any[];
  trench_profiles: any[];
  quotes: any[];
  takeoff: {
    settings: Record<string, any> | null;
    page_scales: any[];
    page_rotations: any[];
    nodes: any[];
    runs: any[];
    points: any[];
    items: any[];
    areas: any[];
    area_points: any[];
    annotations: any[];
  };
  plan: PlanRef | null;
}

/** Catalog FKs to verify on import: column → referenced table. */
const CATALOG_FKS: Record<string, Record<string, string>> = {
  bid_line_items: {
    material_id: 'materials',
    crew_template_id: 'crew_templates',
    production_rate_id: 'production_rates',
    equipment_id: 'equipment',
  },
  trench_profiles: {
    pipe_material_id: 'materials',
    bedding_material_id: 'materials',
    backfill_material_id: 'materials',
  },
  takeoff_runs: {
    pipe_material_id: 'materials',
    bedding_material_id: 'materials',
    backfill_material_id: 'materials',
  },
  takeoff_items: { material_id: 'materials' },
  takeoff_areas: { material_id: 'materials', assembly_id: 'assemblies' },
};

export function exportJob(db: Database.Database, jobId: number): JobSnapshot {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
  if (!job) throw new Error(`Job ${jobId} not found`);

  const all = (sql: string) => db.prepare(sql).all(jobId) as any[];

  // Change-order parents are referenced by cloud id so the link survives on
  // machines where local ids differ.
  let parentCloudId: string | null = null;
  if (job.parent_job_id) {
    const parent = db
      .prepare('SELECT cloud_id FROM jobs WHERE id = ?')
      .get(job.parent_job_id) as any;
    parentCloudId = parent?.cloud_id ?? null;
  }
  const jobOut: Record<string, any> = { ...job, parent_cloud_id: parentCloudId };
  delete jobOut.id;
  delete jobOut.cloud_id;
  delete jobOut.parent_job_id;

  const settings = db
    .prepare('SELECT * FROM takeoff_job_settings WHERE job_id = ?')
    .get(jobId) as any;
  let settingsOut: Record<string, any> | null = null;
  if (settings) {
    const s: Record<string, any> = { ...settings };
    delete s.id;
    delete s.pdf_path; // machine-local; the plan file syncs separately
    settingsOut = s;
  }

  return {
    format: 1,
    job: jobOut,
    sections: all('SELECT * FROM bid_sections WHERE job_id = ? ORDER BY id'),
    line_items: all('SELECT * FROM bid_line_items WHERE job_id = ? ORDER BY id'),
    trench_profiles: all('SELECT * FROM trench_profiles WHERE job_id = ? ORDER BY id'),
    quotes: all('SELECT * FROM quotes WHERE job_id = ? ORDER BY id'),
    takeoff: {
      settings: settingsOut,
      page_scales: all('SELECT * FROM takeoff_page_scales WHERE job_id = ? ORDER BY page_number'),
      page_rotations: all(
        'SELECT * FROM takeoff_page_rotations WHERE job_id = ? ORDER BY page_number'
      ),
      nodes: all('SELECT * FROM takeoff_nodes WHERE job_id = ? ORDER BY id'),
      runs: all('SELECT * FROM takeoff_runs WHERE job_id = ? ORDER BY id'),
      points: all(
        `SELECT p.* FROM takeoff_points p
         JOIN takeoff_runs r ON r.id = p.run_id
         WHERE r.job_id = ? ORDER BY p.id`
      ),
      items: all('SELECT * FROM takeoff_items WHERE job_id = ? ORDER BY id'),
      areas: all('SELECT * FROM takeoff_areas WHERE job_id = ? ORDER BY id'),
      area_points: all(
        `SELECT ap.* FROM takeoff_area_points ap
         JOIN takeoff_areas a ON a.id = ap.area_id
         WHERE a.job_id = ? ORDER BY ap.id`
      ),
      annotations: all('SELECT * FROM takeoff_annotations WHERE job_id = ? ORDER BY id'),
    },
    plan: null, // filled in by the sync engine when a plan PDF exists
  };
}

/** The phone-facing markup overlay document (Phase 4 pulls this, not job.json). */
export function buildMarkupDoc(snapshot: JobSnapshot): Record<string, any> {
  return {
    format: 1,
    job_name: snapshot.job.name,
    plan: snapshot.plan,
    takeoff: snapshot.takeoff,
  };
}

export function snapshotHash(snapshot: JobSnapshot): string {
  const { pushed_at, app_version, ...content } = snapshot;
  return crypto.createHash('sha256').update(stableStringify(content)).digest('hex');
}

export function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k] === undefined ? null : value[k])}`)
    .join(',')}}`;
}

export interface ImportResult {
  jobId: number;
  created: boolean;
  /** Catalog references nulled because the local catalog has no such row. */
  droppedCatalogRefs: number;
}

/**
 * Upsert a snapshot into the local database. Existing child rows are
 * replaced wholesale inside one transaction; the local job id is stable.
 * `pdfPath` is where the sync engine put the downloaded plan (omit to leave
 * any existing local path untouched).
 */
export function importJob(
  db: Database.Database,
  cloudId: string,
  snapshot: JobSnapshot,
  opts: { pdfPath?: string } = {}
): ImportResult {
  if (snapshot.format !== 1) {
    throw new Error(`Unsupported snapshot format ${(snapshot as any).format}`);
  }
  let dropped = 0;

  // SQL-injection invariant for everything below: snapshots are untrusted
  // input, and the only strings ever interpolated into SQL text are (a)
  // table names from this file's own call sites / CATALOG_FKS and (b)
  // column names filtered through columnsOf(), i.e. derived from the local
  // schema via PRAGMA — never from the payload. Payload values only ever
  // bind as ? parameters. Keep it that way.
  const columnsOf = (table: string): Set<string> => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    return new Set(rows.map((r) => r.name));
  };

  const exists = (table: string, id: any): boolean =>
    id != null && !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);

  /** Insert `row` into `table`, keeping only real columns, dropping 'id'. */
  const insertRow = (table: string, row: Record<string, any>): number => {
    const cols = columnsOf(table);
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === 'id' || !cols.has(k)) continue;
      clean[k] = v;
    }
    const fks = CATALOG_FKS[table];
    if (fks) {
      for (const [col, refTable] of Object.entries(fks)) {
        if (clean[col] != null && !exists(refTable, clean[col])) {
          clean[col] = null;
          dropped++;
        }
      }
    }
    const keys = Object.keys(clean);
    const info = db
      .prepare(
        `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
      )
      .run(...keys.map((k) => clean[k]));
    return Number(info.lastInsertRowid);
  };

  const run = db.transaction((): ImportResult => {
    const existing = db.prepare('SELECT id FROM jobs WHERE cloud_id = ?').get(cloudId) as any;

    // Keep this machine's plan path unless the engine downloaded a new file —
    // pdf_path never travels in the snapshot.
    const existingPdfPath = existing
      ? ((db
          .prepare('SELECT pdf_path FROM takeoff_job_settings WHERE job_id = ?')
          .get(existing.id) as any)?.pdf_path ?? null)
      : null;

    const parentCloudId = snapshot.job.parent_cloud_id ?? null;
    const parentRow = parentCloudId
      ? (db.prepare('SELECT id FROM jobs WHERE cloud_id = ?').get(parentCloudId) as any)
      : null;

    const jobCols = columnsOf('jobs');
    const jobFields: Record<string, any> = {};
    for (const [k, v] of Object.entries(snapshot.job)) {
      if (k === 'parent_cloud_id' || k === 'id' || k === 'cloud_id' || k === 'parent_job_id') continue;
      if (jobCols.has(k)) jobFields[k] = v;
    }
    jobFields.parent_job_id = parentRow?.id ?? null;

    let jobId: number;
    if (existing) {
      jobId = existing.id;
      const keys = Object.keys(jobFields);
      db.prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
        ...keys.map((k) => jobFields[k]),
        jobId
      );
      // Children are replaced wholesale; cascades clear points/items/etc.
      for (const sql of [
        'DELETE FROM bid_sections WHERE job_id = ?',
        'DELETE FROM bid_line_items WHERE job_id = ?',
        'DELETE FROM trench_profiles WHERE job_id = ?',
        'DELETE FROM quotes WHERE job_id = ?',
        'DELETE FROM takeoff_items WHERE job_id = ?',
        'DELETE FROM takeoff_runs WHERE job_id = ?',
        'DELETE FROM takeoff_nodes WHERE job_id = ?',
        'DELETE FROM takeoff_areas WHERE job_id = ?',
        'DELETE FROM takeoff_annotations WHERE job_id = ?',
        'DELETE FROM takeoff_page_scales WHERE job_id = ?',
        'DELETE FROM takeoff_page_rotations WHERE job_id = ?',
        'DELETE FROM takeoff_job_settings WHERE job_id = ?',
      ]) {
        db.prepare(sql).run(jobId);
      }
    } else {
      jobId = insertRow('jobs', jobFields);
      db.prepare('UPDATE jobs SET cloud_id = ? WHERE id = ?').run(cloudId, jobId);
    }

    // Sections, then line items (which reference sections).
    const sectionMap = new Map<number, number>();
    for (const s of snapshot.sections) {
      sectionMap.set(s.id, insertRow('bid_sections', { ...s, job_id: jobId }));
    }
    for (const li of snapshot.line_items) {
      const sectionId = sectionMap.get(li.section_id);
      if (sectionId === undefined) continue; // orphan in snapshot; skip
      insertRow('bid_line_items', { ...li, job_id: jobId, section_id: sectionId });
    }

    for (const tp of snapshot.trench_profiles) insertRow('trench_profiles', { ...tp, job_id: jobId });
    for (const q of snapshot.quotes) insertRow('quotes', { ...q, job_id: jobId });

    const t = snapshot.takeoff;

    if (t.settings || opts.pdfPath || existingPdfPath) {
      insertRow('takeoff_job_settings', {
        ...(t.settings || {}),
        job_id: jobId,
        pdf_path: opts.pdfPath ?? existingPdfPath,
      });
    }
    for (const ps of t.page_scales) insertRow('takeoff_page_scales', { ...ps, job_id: jobId });
    for (const pr of t.page_rotations) insertRow('takeoff_page_rotations', { ...pr, job_id: jobId });

    const nodeMap = new Map<number, number>();
    for (const n of t.nodes) nodeMap.set(n.id, insertRow('takeoff_nodes', { ...n, job_id: jobId }));

    const runMap = new Map<number, number>();
    for (const r of t.runs) runMap.set(r.id, insertRow('takeoff_runs', { ...r, job_id: jobId }));

    for (const p of t.points) {
      const runId = runMap.get(p.run_id);
      if (runId === undefined) continue;
      insertRow('takeoff_points', {
        ...p,
        run_id: runId,
        node_id: p.node_id != null ? nodeMap.get(p.node_id) ?? null : null,
      });
    }

    for (const item of t.items) {
      insertRow('takeoff_items', {
        ...item,
        job_id: jobId,
        near_run_id: item.near_run_id != null ? runMap.get(item.near_run_id) ?? null : null,
      });
    }

    const areaMap = new Map<number, number>();
    for (const a of t.areas) areaMap.set(a.id, insertRow('takeoff_areas', { ...a, job_id: jobId }));
    for (const ap of t.area_points) {
      const areaId = areaMap.get(ap.area_id);
      if (areaId === undefined) continue;
      insertRow('takeoff_area_points', { ...ap, area_id: areaId });
    }

    for (const ann of t.annotations) insertRow('takeoff_annotations', { ...ann, job_id: jobId });

    return { jobId, created: !existing, droppedCatalogRefs: dropped };
  });

  return run();
}
