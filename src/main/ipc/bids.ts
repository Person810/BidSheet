import { dialog, app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { getDbPath, isSetupComplete, seedDatabase } from '../database';
import { logger } from '../logger';
import { TradeType } from '../../shared/constants/seed-data';
import { computeBidSummaryFromSections } from '../../shared/bidCalc';
import { safeHandle, getSectionCostRows } from './shared';

export function registerBidHandlers(db: Database.Database): void {
  // ================================================================
  // BID SECTIONS
  // ================================================================

  safeHandle('db:bid-sections:list', (_event, jobId: number) => {
    return db.prepare('SELECT * FROM bid_sections WHERE job_id = ? ORDER BY sort_order').all(jobId);
  });

  safeHandle('db:bid-sections:save', (_event, section: any) => {
    const isAlternate = section.isAlternate ? 1 : 0;
    const overheadOverride = section.overheadPercentOverride ?? null;
    const profitOverride = section.profitPercentOverride ?? null;
    const bondOverride = section.bondPercentOverride ?? null;
    if (section.id) {
      db.prepare(
        `UPDATE bid_sections SET name = ?, sort_order = ?, is_alternate = ?,
          overhead_percent_override = ?, profit_percent_override = ?, bond_percent_override = ?
        WHERE id = ?`
      ).run(section.name, section.sortOrder, isAlternate,
        overheadOverride, profitOverride, bondOverride, section.id);
      return { id: section.id };
    } else {
      const result = db
        .prepare(
          `INSERT INTO bid_sections
            (job_id, name, sort_order, is_alternate,
             overhead_percent_override, profit_percent_override, bond_percent_override)
          VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(section.jobId, section.name, section.sortOrder, isAlternate,
          overheadOverride, profitOverride, bondOverride);
      return { id: Number(result.lastInsertRowid) };
    }
  });

  safeHandle('db:bid-sections:delete', (_event, id: number) => {
    return db.prepare('DELETE FROM bid_sections WHERE id = ?').run(id);
  });

  // ================================================================
  // BID LINE ITEMS
  // ================================================================

  safeHandle('db:line-items:list', (_event, sectionId: number) => {
    return db
      .prepare('SELECT * FROM bid_line_items WHERE section_id = ? ORDER BY sort_order')
      .all(sectionId);
  });

  safeHandle('db:line-items:save', (_event, item: any) => {
    const materialTotal = item.quantity * item.materialUnitCost;
    const laborTotal = item.laborHours * item.laborCostPerHour;
    const equipmentTotal = item.equipmentHours * item.equipmentCostPerHour;
    const totalCost = materialTotal + laborTotal + equipmentTotal + (item.subcontractorCost || 0);
    const unitCost = item.quantity > 0 ? totalCost / item.quantity : 0;

    if (item.id) {
      return db
        .prepare(
          `UPDATE bid_line_items SET
            section_id = ?, job_id = ?, description = ?, quantity = ?, unit = ?, sort_order = ?,
            material_id = ?, material_unit_cost = ?, material_total = ?,
            crew_template_id = ?, production_rate_id = ?, labor_hours = ?, labor_cost_per_hour = ?, labor_total = ?,
            equipment_id = ?, equipment_cost_per_hour = ?, equipment_hours = ?, equipment_total = ?,
            subcontractor_cost = ?, unit_cost = ?, total_cost = ?, notes = ?,
            item_number = ?, cost_code = ?
          WHERE id = ?`
        )
        .run(
          item.sectionId, item.jobId, item.description, item.quantity, item.unit, item.sortOrder,
          item.materialId, item.materialUnitCost, materialTotal,
          item.crewTemplateId, item.productionRateId, item.laborHours, item.laborCostPerHour, laborTotal,
          item.equipmentId || null, item.equipmentCostPerHour, item.equipmentHours, equipmentTotal,
          item.subcontractorCost || 0, unitCost, totalCost, item.notes,
          item.itemNumber || null, item.costCode || null,
          item.id
        );
    } else {
      return db
        .prepare(
          `INSERT INTO bid_line_items (
            section_id, job_id, description, quantity, unit, sort_order,
            material_id, material_unit_cost, material_total,
            crew_template_id, production_rate_id, labor_hours, labor_cost_per_hour, labor_total,
            equipment_id, equipment_cost_per_hour, equipment_hours, equipment_total,
            subcontractor_cost, unit_cost, total_cost, notes, item_number, cost_code
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          item.sectionId, item.jobId, item.description, item.quantity, item.unit, item.sortOrder,
          item.materialId, item.materialUnitCost, materialTotal,
          item.crewTemplateId, item.productionRateId, item.laborHours, item.laborCostPerHour, laborTotal,
          item.equipmentId || null, item.equipmentCostPerHour, item.equipmentHours, equipmentTotal,
          item.subcontractorCost || 0, unitCost, totalCost, item.notes,
          item.itemNumber || null, item.costCode || null
        );
    }
  });

  safeHandle('db:line-items:delete', (_event, id: number) => {
    return db.prepare('DELETE FROM bid_line_items WHERE id = ?').run(id);
  });

  // Scaffold a bid schedule from an owner's item list (DOT/municipal bid
  // forms). Items arrive unpriced; cost columns rely on their 0 defaults.
  safeHandle(
    'db:line-items:import',
    (_event, jobId: number, sectionId: number,
      items: { description: string; quantity: number; unit: string; itemNumber: string | null }[]) => {
      const existing = db.prepare(
        'SELECT COUNT(*) as count FROM bid_line_items WHERE section_id = ?'
      ).get(sectionId) as { count: number };
      const insert = db.prepare(
        `INSERT INTO bid_line_items (section_id, job_id, description, quantity, unit, sort_order, item_number)
        VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      const importAll = db.transaction(() => {
        let sortOrder = existing.count;
        for (const item of items) {
          insert.run(sectionId, jobId, item.description, item.quantity, item.unit, sortOrder++, item.itemNumber);
        }
      });
      importAll();
      logger.info('bid:import-items', `Imported ${items.length} bid items into section ${sectionId} (job ${jobId})`);
      return { imported: items.length };
    }
  );

  // ---- Bid grid undo/redo state restore ----

  // CRITICAL — do not refactor the INSERTs below; keep id AND uuid explicit.
  // Replaces all bid sections + line items for a job in one transaction,
  // preserving both id AND uuid so history snapshots stay valid across
  // undo/redo cycles and cloud-sync identity stays stable. Re-inserting with
  // an explicit uuid suppresses the auto-uuid AFTER INSERT trigger; without
  // that, every undo would mint new uuids and churn the sync layer.
  safeHandle('db:bid:replace-state', (_event, jobId: number, state: any) => {
    const sections: any[] = state?.sections || [];
    const lineItemsBySection: Record<number, any[]> = state?.lineItems || {};

    const insertSection = db.prepare(
      `INSERT INTO bid_sections
        (id, uuid, job_id, name, sort_order, is_alternate,
         overhead_percent_override, profit_percent_override, bond_percent_override)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertItem = db.prepare(
      `INSERT INTO bid_line_items (
        id, uuid, section_id, job_id, description, quantity, unit, sort_order,
        material_id, material_unit_cost, material_total,
        crew_template_id, production_rate_id, labor_hours, labor_cost_per_hour, labor_total,
        equipment_id, equipment_cost_per_hour, equipment_hours, equipment_total,
        subcontractor_cost, unit_cost, total_cost, notes, item_number, cost_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const replaceTx = db.transaction(() => {
      // Line items first (FK → bid_sections), then the sections themselves.
      db.prepare('DELETE FROM bid_line_items WHERE job_id = ?').run(jobId);
      db.prepare('DELETE FROM bid_sections WHERE job_id = ?').run(jobId);

      // Sections before line items so the section_id FK resolves on insert.
      sections.forEach((s, idx) => {
        insertSection.run(
          s.id, s.uuid ?? null, jobId, s.name, s.sort_order ?? idx,
          s.is_alternate ?? 0,
          s.overhead_percent_override ?? null,
          s.profit_percent_override ?? null,
          s.bond_percent_override ?? null
        );
      });

      for (const section of sections) {
        const items = lineItemsBySection[section.id] || [];
        items.forEach((i, idx) => {
          insertItem.run(
            i.id, i.uuid ?? null, section.id, jobId, i.description,
            i.quantity ?? 0, i.unit ?? 'LF', i.sort_order ?? idx,
            i.material_id ?? null, i.material_unit_cost ?? 0, i.material_total ?? 0,
            i.crew_template_id ?? null, i.production_rate_id ?? null,
            i.labor_hours ?? 0, i.labor_cost_per_hour ?? 0, i.labor_total ?? 0,
            i.equipment_id ?? null, i.equipment_cost_per_hour ?? 0,
            i.equipment_hours ?? 0, i.equipment_total ?? 0,
            i.subcontractor_cost ?? 0, i.unit_cost ?? 0, i.total_cost ?? 0,
            i.notes ?? null, i.item_number ?? null, i.cost_code ?? null
          );
        });
      }

      return { success: true };
    });
    return replaceTx();
  });

}
