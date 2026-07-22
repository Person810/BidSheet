import type Database from 'better-sqlite3';
import { logger } from '../logger';
import { safeHandle } from './shared';
import { normalizeDescription } from '../../shared/quoteMatching';
import { rollupLineItemCost } from '../../shared/lineItemCost';
import { parseManualFields, isManual } from '../../shared/manualFields';

/**
 * Per-job price import (§1–4). The renderer drives the reconciliation screen
 * and does all matching with the pure `quoteMatching` module; these handlers
 * only (a) hand the renderer the job's bid lines + learned aliases, and
 * (b) atomically persist the user's confirmed result.
 *
 * Write rules (§3) are enforced here:
 *  - Every incoming row is stored verbatim in raw_quote_lines (provenance).
 *  - A bid line's price is its own frozen snapshot — we update only the
 *    targeted line, never reaching into other jobs.
 *  - The catalog material is the "latest known price": we bump
 *    default_unit_cost and log a price_updates history row stamped with
 *    source. Other bids keep their own per-line snapshots, so nothing
 *    already-bid moves.
 *  - Each confirm teaches the alias table (supplier + normalized description
 *    → material) so the next job auto-matches.
 */

interface CommitRow {
  // Raw quote line (always stored).
  supplier: string;
  description: string;
  unit: string | null;
  price: number;
  partNumber: string | null;
  // What the user chose to do with it.
  action: 'update' | 'create' | 'skip';
  targetLineId?: number | null;
  /** Material to learn the alias against / bump in the catalog. */
  targetMaterialId?: number | null;
  // For 'create':
  newCategoryId?: number | null;
  newSectionId?: number | null;
}

interface CommitPayload {
  source: string;
  rows: CommitRow[];
  /**
   * Other (open, non-locked) jobs the confirmed prices should also be pushed
   * into, matched by material. The current job is always applied; this is
   * purely additive and never includes locked/closed bids.
   */
  applyToJobIds?: number[];
}

const IMPORTED_CATEGORY = 'Imported Items';

export function registerPriceImportHandlers(db: Database.Database): void {
  // Bid lines (with linked-material context) + learned aliases + the picker
  // lists the reconciliation screen needs.
  safeHandle('db:price-import:context', (_event, jobId: number) => {
    const lines = db.prepare(
      `SELECT li.id, li.section_id, li.description, li.unit, li.quantity,
              li.material_id, li.material_unit_cost, li.price_state, li.price_source,
              m.name AS material_name, m.unit AS material_unit,
              m.supplier AS material_supplier, m.part_number AS material_part_number,
              m.aliases AS material_aliases
       FROM bid_line_items li
       LEFT JOIN materials m ON m.id = li.material_id
       WHERE li.job_id = ?
       ORDER BY li.section_id, li.sort_order`,
    ).all(jobId);

    const aliases = db.prepare(
      `SELECT supplier, raw_description, material_id, part_number FROM quote_aliases`,
    ).all();

    const sections = db.prepare(
      `SELECT id, name FROM bid_sections WHERE job_id = ? ORDER BY sort_order`,
    ).all(jobId);

    const categories = db.prepare(
      `SELECT id, name FROM material_categories ORDER BY name`,
    ).all();

    // Other jobs a confirmed price can also be pushed into. A job is "locked"
    // when it's won/lost AND bid_locked — those (and archived) are excluded so
    // an import never disturbs a closed bid. The current job is applied
    // implicitly and so is left out of this list.
    const otherJobs = db.prepare(
      `SELECT id, name, job_number, status FROM jobs
       WHERE id != ? AND parent_job_id IS NULL
         AND status != 'archived'
         AND NOT (status IN ('won', 'lost') AND bid_locked = 1)
       ORDER BY updated_at DESC`,
    ).all(jobId);

    return { lines, aliases, sections, categories, otherJobs };
  });

  safeHandle('db:price-import:commit', (_event, jobId: number, payload: CommitPayload) => {
    const rows = payload?.rows ?? [];
    const source = payload?.source || 'Quote import';

    const job = db.prepare('SELECT job_number FROM jobs WHERE id = ?').get(jobId) as any;
    const stamp = priceSource(job?.job_number ?? null);

    // Re-validate the additional target jobs server-side: they must exist, not
    // be the current job, and not be locked/closed — never trust the renderer
    // to keep a closed bid out of the write set.
    const isLocked = db.prepare(
      `SELECT 1 FROM jobs WHERE id = ?
         AND (status = 'archived' OR (status IN ('won', 'lost') AND bid_locked = 1))`,
    );
    const applyToJobIds = [...new Set(payload?.applyToJobIds ?? [])]
      .filter((id) => id !== jobId && !isLocked.get(id));
    const propagateLines = db.prepare(
      `SELECT id, quantity, labor_total, equipment_total, subcontractor_cost, manual_fields
       FROM bid_line_items WHERE job_id = ? AND material_id = ?`,
    );

    const insertRaw = db.prepare(
      `INSERT INTO raw_quote_lines (job_id, supplier, description, unit, price, part_number, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const getLine = db.prepare('SELECT * FROM bid_line_items WHERE id = ? AND job_id = ?');
    const updateLine = db.prepare(
      `UPDATE bid_line_items SET
         material_unit_cost = ?, material_total = ?, total_cost = ?, unit_cost = ?,
         price_state = 'quoted', price_source = ?
       WHERE id = ?`,
    );
    const getMat = db.prepare('SELECT id, default_unit_cost FROM materials WHERE id = ?');
    const logPrice = db.prepare(
      'INSERT INTO price_updates (material_id, old_price, new_price, source) VALUES (?, ?, ?, ?)',
    );
    const bumpMat = db.prepare(
      `UPDATE materials SET default_unit_cost = ?, last_price_update = datetime('now', 'localtime'),
         supplier = COALESCE(NULLIF(?, ''), supplier),
         part_number = COALESCE(NULLIF(?, ''), part_number),
         cost_per_cy = CASE WHEN tons_per_cy > 0 THEN round(? * tons_per_cy, 2) ELSE cost_per_cy END
       WHERE id = ?`,
    );
    const upsertAlias = db.prepare(
      `INSERT INTO quote_aliases (supplier, raw_description, material_id, part_number)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(supplier, raw_description) DO UPDATE SET
         material_id = excluded.material_id,
         part_number = COALESCE(NULLIF(excluded.part_number, ''), quote_aliases.part_number),
         updated_at = datetime('now', 'localtime')`,
    );

    const result = {
      rawStored: 0, updatedLines: 0, createdItems: 0, catalogUpdates: 0, skipped: 0,
      propagatedLines: 0, propagatedJobs: 0,
    };

    const commit = db.transaction(() => {
      // Push one material's confirmed price into the selected other jobs,
      // matched by material_id. Each line keeps its own quantity (its frozen
      // snapshot), so only the unit price + rollup move. A material is pushed
      // once per import even if several quote rows map to it.
      const propagatedMaterials = new Set<number>();
      const touchedJobs = new Set<number>();
      const propagateToOtherJobs = (materialId: number, price: number, sourceLabel: string) => {
        if (applyToJobIds.length === 0 || propagatedMaterials.has(materialId)) return;
        propagatedMaterials.add(materialId);
        for (const otherJobId of applyToJobIds) {
          for (const ln of propagateLines.all(otherJobId, materialId) as any[]) {
            // A hand-typed material price is sticky (§5): never overwrite
            // it — or its price_state/price_source — from another job's import.
            if (isManual(parseManualFields(ln.manual_fields), 'materialUnitCost')) continue;
            const matTotal = (ln.quantity || 0) * price;
            const { totalCost, unitCost } = rollupLineItemCost({
              materialTotal: matTotal,
              laborTotal: ln.labor_total || 0,
              equipmentTotal: ln.equipment_total || 0,
              subcontractorCost: ln.subcontractor_cost || 0,
            }, ln.quantity || 0);
            updateLine.run(price, matTotal, totalCost, unitCost, sourceLabel, ln.id);
            result.propagatedLines++;
            touchedJobs.add(otherJobId);
          }
        }
      };

      let importedCategoryId: number | null = null;
      const ensureImportedCategory = (): number => {
        if (importedCategoryId != null) return importedCategoryId;
        const existing = db.prepare('SELECT id FROM material_categories WHERE name = ?')
          .get(IMPORTED_CATEGORY) as { id: number } | undefined;
        const id = existing
          ? existing.id
          : Number(db.prepare('INSERT INTO material_categories (name, description) VALUES (?, ?)')
              .run(IMPORTED_CATEGORY, 'Items created from imported supplier quotes').lastInsertRowid);
        importedCategoryId = id;
        return id;
      };

      const learn = (supplier: string, description: string, materialId: number, partNumber: string | null) => {
        upsertAlias.run((supplier || '').trim(), normalizeDescription(description), materialId, partNumber || null);
      };

      for (const row of rows) {
        // (1) Provenance: store every incoming row, immutably, regardless of action.
        insertRaw.run(jobId, row.supplier || '', row.description, row.unit, row.price, row.partNumber || null, source);
        result.rawStored++;

        if (row.action === 'skip') {
          result.skipped++;
          continue;
        }

        if (row.action === 'update' && row.targetLineId) {
          const line = getLine.get(row.targetLineId, jobId) as any;
          if (!line) { result.skipped++; continue; }

          const materialTotal = (line.quantity || 0) * row.price;
          const { totalCost, unitCost } = rollupLineItemCost({
            materialTotal,
            laborTotal: line.labor_total || 0,
            equipmentTotal: line.equipment_total || 0,
            subcontractorCost: line.subcontractor_cost || 0,
          }, line.quantity || 0);
          updateLine.run(row.price, materialTotal, totalCost, unitCost, `${row.supplier || 'Quote'}${stamp}`, line.id);
          result.updatedLines++;

          // Catalog = latest known price. Bump + log history when the line is
          // linked to a material. This never touches other bids' frozen lines.
          const matId = row.targetMaterialId ?? line.material_id;
          if (matId) {
            const mat = getMat.get(matId) as any;
            if (mat) {
              if (mat.default_unit_cost !== row.price) {
                logPrice.run(matId, mat.default_unit_cost, row.price, `${source}${stamp}`);
                bumpMat.run(row.price, row.supplier || '', row.partNumber || '', row.price, matId);
                result.catalogUpdates++;
              }
              learn(row.supplier, row.description, matId, row.partNumber || null);
            }
            // Push into the user-selected other jobs (matched by material).
            propagateToOtherJobs(matId, row.price, `${row.supplier || 'Quote'}${stamp}`);
          }
          continue;
        }

        if (row.action === 'create') {
          const categoryId = row.newCategoryId ?? ensureImportedCategory();
          const newMatId = Number(db.prepare(
            `INSERT INTO materials (category_id, name, description, unit, default_unit_cost, supplier, part_number)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ).run(categoryId, row.description, null, row.unit || 'EA', row.price,
            row.supplier || null, row.partNumber || null).lastInsertRowid);

          // Seed the catalog history so the new item has provenance too.
          logPrice.run(newMatId, 0, row.price, `${source}${stamp}`);
          learn(row.supplier, row.description, newMatId, row.partNumber || null);
          result.createdItems++;

          // Optionally drop it into the bid as a fresh, quoted line (qty 0 so
          // it never injects a phantom quantity into the total).
          if (row.newSectionId) {
            const maxSort = (db.prepare(
              'SELECT COALESCE(MAX(sort_order), -1) AS s FROM bid_line_items WHERE section_id = ?',
            ).get(row.newSectionId) as any).s as number;
            db.prepare(
              `INSERT INTO bid_line_items
                 (section_id, job_id, description, quantity, unit, sort_order,
                  material_id, material_unit_cost, material_total, price_state, price_source)
               VALUES (?, ?, ?, 0, ?, ?, ?, ?, 0, 'quoted', ?)`,
            ).run(row.newSectionId, jobId, row.description, row.unit || 'EA', maxSort + 1,
              newMatId, row.price, `${row.supplier || 'Quote'}${stamp}`);
          }
          continue;
        }

        result.skipped++;
      }
      result.propagatedJobs = touchedJobs.size;
    });

    commit();

    // Price-state tally for the payoff line (§4), over the whole job.
    const counts = db.prepare(
      `SELECT price_state AS state, COUNT(*) AS n FROM bid_line_items WHERE job_id = ? GROUP BY price_state`,
    ).all(jobId) as { state: string; n: number }[];
    const stateCounts = { seed: 0, past_price: 0, quoted: 0, confirmed: 0, total: 0 };
    for (const c of counts) {
      if (c.state in stateCounts) (stateCounts as any)[c.state] = c.n;
      stateCounts.total += c.n;
    }

    logger.info('price-import:commit',
      `Job ${jobId}: ${result.updatedLines} lines updated, ${result.createdItems} created, ` +
      `${result.catalogUpdates} catalog prices, ${result.rawStored} raw rows stored, ` +
      `${result.propagatedLines} lines across ${result.propagatedJobs} other jobs`);

    return { ...result, stateCounts };
  });
}

/** ", job #1142, Jun 2026" style stamp for price provenance. */
function priceSource(jobNumber: string | null): string {
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'short', year: 'numeric' });
  return `${jobNumber ? `, job #${jobNumber}` : ''}, ${month}`;
}
