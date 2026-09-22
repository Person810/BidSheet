import type Database from 'better-sqlite3';
import type { PriceLogEntry, PriceLogKind } from '../shared/types/ipc';

export type { PriceLogEntry, PriceLogKind };

/**
 * Pricing audit log: one place that records a catalog price change, whatever
 * path made it (inline edit, edit form, CSV import, cloud sync from another
 * seat). Material prices go to the original price_updates table (older import
 * paths and the stale-price logic already use it); labor and equipment rates
 * go to rate_updates (V55). Both are local history — neither is synced — so
 * a change pulled in from another computer is logged here as 'Cloud sync'.
 */

/** The pricing columns worth auditing, per catalog table. */
export const PRICE_FIELDS: Record<string, { kind: PriceLogKind; fields: string[] }> = {
  materials: { kind: 'material', fields: ['default_unit_cost'] },
  labor_roles: { kind: 'labor_role', fields: ['default_hourly_rate', 'burden_multiplier'] },
  equipment: { kind: 'equipment', fields: ['hourly_rate', 'daily_rate', 'mobilization_cost'] },
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Log every pricing field that differs between `before` and `after` (snake_case
 * rows of `table`). Returns true when anything was logged. Values compare as
 * numbers, so 12 vs '12' or 0.1+0.2 noise below a hundredth of a cent never
 * logs a phantom change.
 */
export function logPriceChanges(
  db: Database.Database,
  table: string,
  itemId: number,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  source: string,
): boolean {
  const spec = PRICE_FIELDS[table];
  if (!spec || !before) return false;
  let logged = false;
  for (const field of spec.fields) {
    if (!(field in after)) continue;
    const oldV = num(before[field]);
    const newV = num(after[field]);
    if (oldV === newV) continue;
    if (oldV !== null && newV !== null && Math.abs(oldV - newV) < 0.00005) continue;
    if (spec.kind === 'material') {
      db.prepare(
        'INSERT INTO price_updates (material_id, old_price, new_price, source) VALUES (?, ?, ?, ?)'
      ).run(itemId, oldV ?? 0, newV ?? 0, source);
    } else {
      db.prepare(
        `INSERT INTO rate_updates (kind, item_id, item_name, field, old_value, new_value, source)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(spec.kind, itemId, String(after.name ?? before.name ?? ''), field, oldV, newV, source);
    }
    logged = true;
  }
  return logged;
}

/** Newest-first log across materials, labor and equipment. */
export function listPriceLog(
  db: Database.Database,
  opts: { kind?: PriceLogKind; itemId?: number; limit?: number } = {},
): PriceLogEntry[] {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 500), 1), 5000);
  // Ids are per table: an item filter only means something with its type.
  opts = { ...opts, itemId: opts.kind ? opts.itemId : undefined };
  const parts: string[] = [];
  const params: Array<string | number> = [];
  if (!opts.kind || opts.kind === 'material') {
    parts.push(`SELECT 'material' AS kind, p.material_id AS itemId,
        COALESCE(m.name, '(deleted material)') AS itemName, 'default_unit_cost' AS field,
        p.old_price AS oldValue, p.new_price AS newValue, p.source AS source, p.updated_at AS changedAt,
        p.id AS seq, 0 AS tbl
      FROM price_updates p LEFT JOIN materials m ON m.id = p.material_id
      ${opts.itemId != null ? 'WHERE p.material_id = ?' : ''}`);
    if (opts.itemId != null) params.push(opts.itemId);
  }
  if (opts.kind !== 'material') {
    const where: string[] = [];
    if (opts.kind) { where.push('kind = ?'); params.push(opts.kind); }
    if (opts.itemId != null) { where.push('item_id = ?'); params.push(opts.itemId); }
    parts.push(`SELECT kind, item_id AS itemId, item_name AS itemName, field,
        old_value AS oldValue, new_value AS newValue, source, updated_at AS changedAt,
        id AS seq, 1 AS tbl
      FROM rate_updates ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`);
  }
  const rows = db.prepare(
    `SELECT kind, itemId, itemName, field, oldValue, newValue, source, changedAt
     FROM (${parts.join(' UNION ALL ')})
     ORDER BY changedAt DESC, tbl DESC, seq DESC
     LIMIT ${limit}`
  ).all(...params) as PriceLogEntry[];
  return rows;
}
