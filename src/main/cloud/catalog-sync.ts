/**
 * Account-wide catalog sync (Phase 3d): materials, labor, crews, equipment,
 * assemblies, and company settings travel as one JSON snapshot keyed by the
 * stable row UUIDs from migration v28. Integer ids never leave the machine.
 *
 * Import is a row-level merge, not a wholesale replace: rows are matched by
 * uuid and inserted or updated (remote wins per row); local rows the
 * snapshot doesn't mention are kept. After a pull, the sync engine re-pushes
 * the merged result, so additions made on two machines union instead of
 * clobbering. Known v1 limitation: hard deletions don't propagate — a row
 * deleted on one machine is re-added by the next push from another (the
 * common catalog tables soft-delete via is_active, which syncs fine as an
 * update).
 *
 * Catalog FKs are intra-snapshot (materials → categories, members → crews…)
 * and travel as <col>_uuid; parents import before children, and a child
 * whose parent can't be resolved is skipped and counted, never invented.
 */

import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { logger } from '../logger';
import { stableStringify } from './serializer';
import { validateCatalog } from './validate-snapshot';

export interface CatalogSnapshot {
  format: 1;
  pushed_at?: string;
  app_version?: string;
  settings: Record<string, any> | null;
  material_categories: any[];
  materials: any[];
  labor_roles: any[];
  equipment: any[];
  crew_templates: any[];
  crew_members: any[];
  production_rates: any[];
  assemblies: any[];
  assembly_items: any[];
  /** Client records (#94). Optional: absent in pre-v44 snapshots. */
  clients?: any[];
}

/**
 * Company-level app_settings columns that sync. Machine-local state
 * (setup_complete, local_only_mode, backup bookkeeping, lock prefs, the
 * wizard's trade picks) deliberately stays home.
 */
const SYNCED_SETTINGS = [
  'company_name',
  'company_address',
  'company_phone',
  'company_email',
  'company_tagline',
  'company_logo',
  'default_overhead_percent',
  'default_profit_percent',
  'default_tax_percent',
  'default_bond_percent',
  'job_number_auto',
  'job_number_format',
  'job_number_start',
  'unit_system',
  'hdd_rates_json',
] as const;

/** Intra-catalog FKs: column → referenced table. All are NOT NULL columns. */
const CATALOG_TABLE_FKS: Record<string, Record<string, string>> = {
  materials: { category_id: 'material_categories' },
  production_rates: { crew_template_id: 'crew_templates' },
  assembly_items: { assembly_id: 'assemblies', material_id: 'materials' },
};

/** Snapshot key → table, in dependency order (parents before children). */
const UUID_CATALOG_TABLES = [
  'material_categories',
  'labor_roles',
  'equipment',
  'crew_templates',
  'assemblies',
  'clients',
  'materials',
  'production_rates',
  'assembly_items',
] as const;

export function exportCatalog(db: Database.Database): CatalogSnapshot {
  const uuidOf = (refTable: string, id: any): string | null =>
    id == null
      ? null
      : ((db.prepare(`SELECT uuid FROM ${refTable} WHERE id = ?`).get(id) as any)?.uuid ?? null);

  const exportTable = (table: string): any[] => {
    const fks = CATALOG_TABLE_FKS[table];
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY uuid`).all() as any[];
    return rows.map((row) => {
      const out: Record<string, any> = { ...row };
      delete out.id;
      if (fks) {
        for (const [col, refTable] of Object.entries(fks)) {
          out[col.replace(/_id$/, '_uuid')] = uuidOf(refTable, out[col]);
          delete out[col];
        }
      }
      return out;
    });
  };

  // crew_members has no uuid of its own — it's the (crew, role, qty)
  // composition of a crew template, replaced wholesale per template.
  const crewMembers = db
    .prepare(
      `SELECT ct.uuid AS crew_template_uuid, lr.uuid AS labor_role_uuid, cm.quantity
       FROM crew_members cm
       JOIN crew_templates ct ON ct.id = cm.crew_template_id
       JOIN labor_roles lr ON lr.id = cm.labor_role_id
       ORDER BY ct.uuid, lr.uuid, cm.id`
    )
    .all() as any[];

  const settingsRow = db
    .prepare(`SELECT ${SYNCED_SETTINGS.join(', ')} FROM app_settings WHERE id = 1`)
    .get() as Record<string, any> | undefined;

  return {
    format: 1,
    settings: settingsRow ?? null,
    material_categories: exportTable('material_categories'),
    materials: exportTable('materials'),
    labor_roles: exportTable('labor_roles'),
    equipment: exportTable('equipment'),
    crew_templates: exportTable('crew_templates'),
    crew_members: crewMembers,
    production_rates: exportTable('production_rates'),
    assemblies: exportTable('assemblies'),
    assembly_items: exportTable('assembly_items'),
    clients: exportTable('clients'),
  };
}

/** Content hash minus volatile metadata — comparable across machines. */
export function catalogHash(snapshot: CatalogSnapshot): string {
  const { pushed_at, app_version, ...content } = snapshot;
  return crypto.createHash('sha256').update(stableStringify(content)).digest('hex');
}

export interface CatalogImportResult {
  /** Rows inserted or updated (drives the "catalog updated" toast). */
  applied: number;
  /** Rows skipped because a parent reference couldn't be resolved. */
  skipped: number;
}

export function importCatalog(db: Database.Database, raw: unknown): CatalogImportResult {
  // Untrusted input — same boundary rules as job snapshots.
  const snapshot = validateCatalog(raw);
  let applied = 0;
  let skipped = 0;

  // Same SQL-injection invariant as importJob: interpolated table/column
  // names come only from this module's constants and PRAGMA table_info —
  // payload values bind as parameters, always.
  const columnsOf = (table: string): Set<string> => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    return new Set(rows.map((r) => r.name));
  };
  const idForUuid = (table: string, uuid: any): number | null => {
    if (typeof uuid !== 'string') return null;
    const row = db.prepare(`SELECT id FROM ${table} WHERE uuid = ?`).get(uuid) as any;
    return row?.id ?? null;
  };

  const upsertTable = (table: string, rows: any[]): void => {
    const cols = columnsOf(table);
    const fks = CATALOG_TABLE_FKS[table] ?? {};
    for (const row of rows) {
      const source: Record<string, any> = { ...row };
      if (typeof source.uuid !== 'string' || !source.uuid) {
        skipped++;
        continue;
      }
      // Resolve parent uuids; every catalog FK column is NOT NULL, so an
      // unresolvable parent means the row can't exist here — skip it.
      let missingParent = false;
      for (const [col, refTable] of Object.entries(fks)) {
        const uuidKey = col.replace(/_id$/, '_uuid');
        const refUuid = source[uuidKey];
        delete source[uuidKey];
        const localId = refUuid == null ? null : idForUuid(refTable, refUuid);
        if (localId == null) missingParent = true;
        source[col] = localId;
      }
      if (missingParent) {
        skipped++;
        continue;
      }

      const clean: Record<string, any> = {};
      for (const [k, v] of Object.entries(source)) {
        if (k === 'id' || !cols.has(k)) continue;
        clean[k] = v;
      }

      const existing = db.prepare(`SELECT * FROM ${table} WHERE uuid = ?`).get(clean.uuid) as any;
      if (existing) {
        const changedKeys = Object.keys(clean).filter((k) => clean[k] !== existing[k]);
        if (changedKeys.length === 0) continue; // identical — no write, no count
        db.prepare(
          `UPDATE ${table} SET ${changedKeys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`
        ).run(...changedKeys.map((k) => clean[k]), existing.id);
        applied++;
      } else {
        const keys = Object.keys(clean);
        db.prepare(
          `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
        ).run(...keys.map((k) => clean[k]));
        applied++;
      }
    }
  };

  const run = db.transaction(() => {
    for (const table of UUID_CATALOG_TABLES) {
      // Optional tables (clients) are absent in snapshots from older builds.
      upsertTable(table, (snapshot as any)[table] ?? []);
    }

    // crew_members: wholesale replace for every template the snapshot
    // covers (local-only templates keep theirs). Skipped silently when the
    // composition already matches, so unchanged crews never count as
    // "updates" in the toast.
    const templateIds = new Map<string, number>();
    for (const ct of snapshot.crew_templates) {
      const id = idForUuid('crew_templates', ct.uuid);
      if (typeof ct.uuid === 'string' && id != null) templateIds.set(ct.uuid, id);
    }
    const incoming: { templateId: number; roleId: number; quantity: number }[] = [];
    for (const m of snapshot.crew_members) {
      const templateId = m.crew_template_uuid != null ? templateIds.get(m.crew_template_uuid) : undefined;
      const roleId = idForUuid('labor_roles', m.labor_role_uuid);
      if (templateId === undefined || roleId == null || typeof m.quantity !== 'number') {
        skipped++;
        continue;
      }
      incoming.push({ templateId, roleId, quantity: m.quantity });
    }
    if (templateIds.size > 0) {
      const ids = [...templateIds.values()];
      const current = db
        .prepare(
          `SELECT crew_template_id, labor_role_id, quantity FROM crew_members
           WHERE crew_template_id IN (${ids.map(() => '?').join(', ')})
           ORDER BY crew_template_id, labor_role_id`
        )
        .all(...ids) as any[];
      const key = (r: { [k: string]: any }) =>
        `${r.crew_template_id ?? r.templateId}|${r.labor_role_id ?? r.roleId}|${r.quantity}`;
      const same =
        current.length === incoming.length &&
        new Set(current.map(key)).size === new Set([...current, ...incoming].map(key)).size;
      if (!same) {
        db.prepare(
          `DELETE FROM crew_members WHERE crew_template_id IN (${ids.map(() => '?').join(', ')})`
        ).run(...ids);
        const insert = db.prepare(
          'INSERT INTO crew_members (crew_template_id, labor_role_id, quantity) VALUES (?, ?, ?)'
        );
        for (const m of incoming) insert.run(m.templateId, m.roleId, m.quantity);
        applied++;
      }
    }

    // Company settings: single-row merge, remote wins per column.
    if (snapshot.settings) {
      const current = db.prepare('SELECT * FROM app_settings WHERE id = 1').get() as any;
      if (current) {
        const cols = columnsOf('app_settings');
        const changed = SYNCED_SETTINGS.filter(
          (k) =>
            cols.has(k) &&
            Object.prototype.hasOwnProperty.call(snapshot.settings, k) &&
            snapshot.settings![k] !== current[k]
        );
        if (changed.length > 0) {
          db.prepare(
            `UPDATE app_settings SET ${changed.map((k) => `${k} = ?`).join(', ')} WHERE id = 1`
          ).run(...changed.map((k) => snapshot.settings![k]));
          applied++;
        }
      }
    }
  });
  run();

  if (skipped > 0) {
    logger.warn('cloud-catalog', `Catalog import skipped ${skipped} row(s) with unresolvable references`);
  }
  return { applied, skipped };
}
