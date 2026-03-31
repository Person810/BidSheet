import { ipcMain, dialog, app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { getDbPath } from './database';
import { logger } from './logger';
import type Database from 'better-sqlite3';
import { isSetupComplete, seedDatabase } from './database';
import { TradeType } from '../shared/constants/seed-data';

// ================================================================
// Error handling utilities
// ================================================================

/**
 * Translate raw SQLite / filesystem errors into plain-English messages
 * that a contractor (not a developer) can act on.
 */
function friendlyMessage(err: any): string {
  const msg = err.message || String(err);
  const code = err.code || '';

  // SQLite errors
  if (code === 'SQLITE_BUSY' || msg.includes('database is locked')) {
    return 'Database is busy. Try again in a moment.';
  }
  if (code === 'SQLITE_CONSTRAINT' || msg.includes('UNIQUE constraint')) {
    return 'This record conflicts with existing data. Check for duplicates.';
  }
  if (code === 'SQLITE_CORRUPT' || msg.includes('database disk image is malformed')) {
    return 'Database file may be damaged. Try restoring from a backup.';
  }
  if (code === 'SQLITE_READONLY' || msg.includes('attempt to write a readonly')) {
    return 'Database is read-only. Check file permissions or disk space.';
  }
  if (code === 'SQLITE_FULL' || msg.includes('database or disk is full')) {
    return 'Disk is full. Free some space and try again.';
  }

  // Filesystem errors
  if (msg.includes('ENOENT') || msg.includes('no such file')) {
    return 'File not found. It may have been moved or deleted.';
  }
  if (msg.includes('EACCES') || msg.includes('permission denied')) {
    return 'Permission denied. Check that BidSheet has access to this file.';
  }
  if (msg.includes('ENOSPC') || msg.includes('no space left')) {
    return 'Disk is full. Free some space and try again.';
  }

  return 'Something went wrong. Check the log for details.';
}

/**
 * Wraps an IPC handler with try/catch, structured logging, and
 * user-friendly error translation. The re-thrown Error carries a
 * plain-English message; Electron serializes it back to the renderer
 * as a rejected promise.
 */
function safeHandle(
  channel: string,
  fn: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return fn(event, ...args);
    } catch (err: any) {
      // Errors thrown deliberately (no .code) already have user-friendly
      // messages -- pass them through. System errors (SQLite, fs) carry a
      // .code and need translation.
      const friendly = err.code ? friendlyMessage(err) : (err.message || friendlyMessage(err));
      logger.error(channel, friendly, err.stack || err.message);
      throw new Error(friendly);
    }
  });
}

// ================================================================
// Handler registration
// ================================================================

export function registerIpcHandlers(db: Database.Database): void {
  // ================================================================
  // SETUP
  // ================================================================

  safeHandle('db:setup:is-complete', () => {
    return isSetupComplete(db);
  });

  safeHandle(
    'db:setup:run',
    (_event, trades: string[], includeBallparkPrices: boolean, companyName: string) => {
      seedDatabase(db, trades as TradeType[], includeBallparkPrices, companyName);
      logger.info('setup', `Setup complete: trades=${trades.join(',')}, company=${companyName}`);
      return { success: true };
    }
  );

  // ================================================================
  // MATERIAL CATEGORIES
  // ================================================================

  safeHandle('db:material-categories:list', () => {
    return db.prepare('SELECT * FROM material_categories ORDER BY name').all();
  });

  // ================================================================
  // MATERIALS
  // ================================================================

  safeHandle('db:materials:list', (_event, categoryId?: number) => {
    if (categoryId) {
      return db
        .prepare('SELECT * FROM materials WHERE category_id = ? AND is_active = 1 ORDER BY name')
        .all(categoryId);
    }
    return db.prepare('SELECT * FROM materials WHERE is_active = 1 ORDER BY name').all();
  });

  safeHandle('db:materials:list-by-category-name', (_event, categoryName: string) => {
    return db.prepare(
      `SELECT m.*, mc.name as category_name FROM materials m
       JOIN material_categories mc ON m.category_id = mc.id
       WHERE mc.name = ? AND m.is_active = 1 ORDER BY m.name`
    ).all(categoryName);
  });

  safeHandle('db:materials:get', (_event, id: number) => {
    return db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
  });

  safeHandle('db:materials:save', (_event, material: any) => {
    if (material.id) {
      return db
        .prepare(
          `UPDATE materials SET
            category_id = ?, name = ?, description = ?, unit = ?,
            default_unit_cost = ?, supplier = ?, part_number = ?,
            last_price_update = datetime('now', 'localtime'), notes = ?, aliases = ?, is_active = ?
          WHERE id = ?`
        )
        .run(
          material.categoryId, material.name, material.description,
          material.unit, material.defaultUnitCost, material.supplier,
          material.partNumber, material.notes, material.aliases || null,
          material.isActive ? 1 : 0, material.id
        );
    } else {
      return db
        .prepare(
          `INSERT INTO materials (category_id, name, description, unit, default_unit_cost, supplier, part_number, notes, aliases, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(
          material.categoryId, material.name, material.description,
          material.unit, material.defaultUnitCost, material.supplier,
          material.partNumber, material.notes, material.aliases || null
        );
    }
  });

  safeHandle('db:materials:delete', (_event, id: number) => {
    return db.prepare('UPDATE materials SET is_active = 0 WHERE id = ?').run(id);
  });

  safeHandle(
    'db:materials:update-price',
    (_event, id: number, newPrice: number, source: string) => {
      const material = db.prepare('SELECT default_unit_cost FROM materials WHERE id = ?').get(id) as any;
      if (!material) return null;

      const updatePrice = db.transaction(() => {
        db.prepare(
          `INSERT INTO price_updates (material_id, old_price, new_price, source) VALUES (?, ?, ?, ?)`
        ).run(id, material.default_unit_cost, newPrice, source);

        db.prepare(
          `UPDATE materials SET default_unit_cost = ?, last_price_update = datetime('now', 'localtime') WHERE id = ?`
        ).run(newPrice, id);
      });

      updatePrice();
      return { success: true };
    }
  );

  // ================================================================
  // LABOR ROLES
  // ================================================================

  safeHandle('db:labor-roles:list', () => {
    return db.prepare('SELECT * FROM labor_roles ORDER BY name').all();
  });

  safeHandle('db:labor-roles:save', (_event, role: any) => {
    if (role.id) {
      return db
        .prepare(
          `UPDATE labor_roles SET name = ?, default_hourly_rate = ?, burden_multiplier = ?, notes = ?, aliases = ? WHERE id = ?`
        )
        .run(role.name, role.defaultHourlyRate, role.burdenMultiplier, role.notes, role.aliases || null, role.id);
    } else {
      return db
        .prepare(
          `INSERT INTO labor_roles (name, default_hourly_rate, burden_multiplier, notes, aliases) VALUES (?, ?, ?, ?, ?)`
        )
        .run(role.name, role.defaultHourlyRate, role.burdenMultiplier, role.notes, role.aliases || null);
    }
  });

  safeHandle('db:labor-roles:delete', (_event, id: number) => {
    const refs = db.prepare('SELECT COUNT(*) as count FROM crew_members WHERE labor_role_id = ?').get(id) as any;
    if (refs.count > 0) {
      throw new Error('Remove this role from all crew templates first.');
    }
    return db.prepare('DELETE FROM labor_roles WHERE id = ?').run(id);
  });

  // ================================================================
  // CREW TEMPLATES
  // ================================================================

  safeHandle('db:crew-templates:list', () => {
    const templates = db.prepare('SELECT * FROM crew_templates ORDER BY name').all() as any[];
    return templates.map((t) => ({
      ...t,
      members: db
        .prepare(
          `SELECT cm.*, lr.name as role_name, lr.default_hourly_rate, lr.burden_multiplier
          FROM crew_members cm
          JOIN labor_roles lr ON cm.labor_role_id = lr.id
          WHERE cm.crew_template_id = ?`
        )
        .all(t.id),
    }));
  });

  safeHandle('db:crew-templates:get', (_event, id: number) => {
    const template = db.prepare('SELECT * FROM crew_templates WHERE id = ?').get(id) as any;
    if (!template) return null;
    template.members = db
      .prepare(
        `SELECT cm.*, lr.name as role_name, lr.default_hourly_rate, lr.burden_multiplier
        FROM crew_members cm
        JOIN labor_roles lr ON cm.labor_role_id = lr.id
        WHERE cm.crew_template_id = ?`
      )
      .all(id);
    return template;
  });

  safeHandle('db:crew-templates:save', (_event, template: any) => {
    const saveTemplate = db.transaction(() => {
      let templateId: number;

      if (template.id) {
        db.prepare('UPDATE crew_templates SET name = ?, description = ? WHERE id = ?').run(
          template.name, template.description, template.id
        );
        templateId = template.id;
        db.prepare('DELETE FROM crew_members WHERE crew_template_id = ?').run(templateId);
      } else {
        const result = db
          .prepare('INSERT INTO crew_templates (name, description) VALUES (?, ?)')
          .run(template.name, template.description);
        templateId = Number(result.lastInsertRowid);
      }

      const insertMember = db.prepare(
        'INSERT INTO crew_members (crew_template_id, labor_role_id, quantity) VALUES (?, ?, ?)'
      );
      for (const member of template.members || []) {
        insertMember.run(templateId, member.laborRoleId, member.quantity);
      }

      return templateId;
    });

    return saveTemplate();
  });

  safeHandle('db:crew-templates:delete', (_event, id: number) => {
    const bidRefs = db.prepare('SELECT COUNT(*) as count FROM bid_line_items WHERE crew_template_id = ?').get(id) as any;
    if (bidRefs.count > 0) {
      throw new Error('Remove this crew from all bid line items first.');
    }
    const prodRefs = db.prepare('SELECT COUNT(*) as count FROM production_rates WHERE crew_template_id = ?').get(id) as any;
    if (prodRefs.count > 0) {
      throw new Error('Delete the production rates using this crew first.');
    }
    return db.prepare('DELETE FROM crew_templates WHERE id = ?').run(id);
  });

  // ================================================================
  // PRODUCTION RATES
  // ================================================================

  safeHandle('db:production-rates:list', () => {
    return db
      .prepare(
        `SELECT pr.*, ct.name as crew_name
        FROM production_rates pr
        JOIN crew_templates ct ON pr.crew_template_id = ct.id
        ORDER BY pr.description`
      )
      .all();
  });

  safeHandle('db:production-rates:save', (_event, rate: any) => {
    if (rate.id) {
      return db
        .prepare(
          `UPDATE production_rates SET description = ?, crew_template_id = ?, unit = ?, rate_per_hour = ?, conditions = ?, notes = ? WHERE id = ?`
        )
        .run(rate.description, rate.crewTemplateId, rate.unit, rate.ratePerHour, rate.conditions, rate.notes, rate.id);
    } else {
      return db
        .prepare(
          `INSERT INTO production_rates (description, crew_template_id, unit, rate_per_hour, conditions, notes) VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(rate.description, rate.crewTemplateId, rate.unit, rate.ratePerHour, rate.conditions, rate.notes);
    }
  });

  safeHandle('db:production-rates:delete', (_event, id: number) => {
    const refs = db.prepare('SELECT COUNT(*) as count FROM bid_line_items WHERE production_rate_id = ?').get(id) as any;
    if (refs.count > 0) {
      throw new Error('Remove this production rate from all bid line items first.');
    }
    return db.prepare('DELETE FROM production_rates WHERE id = ?').run(id);
  });

  // ================================================================
  // EQUIPMENT
  // ================================================================

  safeHandle('db:equipment:list', () => {
    return db.prepare('SELECT * FROM equipment WHERE is_active = 1 ORDER BY category, name').all();
  });

  safeHandle('db:equipment:save', (_event, equip: any) => {
    if (equip.id) {
      return db
        .prepare(
          `UPDATE equipment SET name = ?, category = ?, hourly_rate = ?, daily_rate = ?,
            mobilization_cost = ?, fuel_cost_per_hour = ?, notes = ?, aliases = ?, is_owned = ?, is_active = ?
          WHERE id = ?`
        )
        .run(
          equip.name, equip.category, equip.hourlyRate, equip.dailyRate,
          equip.mobilizationCost, equip.fuelCostPerHour, equip.notes, equip.aliases || null,
          equip.isOwned ? 1 : 0, equip.isActive ? 1 : 0, equip.id
        );
    } else {
      return db
        .prepare(
          `INSERT INTO equipment (name, category, hourly_rate, daily_rate, mobilization_cost, fuel_cost_per_hour, notes, aliases, is_owned)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          equip.name, equip.category, equip.hourlyRate, equip.dailyRate,
          equip.mobilizationCost, equip.fuelCostPerHour, equip.notes, equip.aliases || null,
          equip.isOwned ? 1 : 0
        );
    }
  });

  safeHandle('db:equipment:delete', (_event, id: number) => {
    return db.prepare('UPDATE equipment SET is_active = 0 WHERE id = ?').run(id);
  });

  // ================================================================
  // JOBS
  // ================================================================

  safeHandle('db:jobs:list', (_event, status?: string) => {
    if (status) {
      return db.prepare('SELECT * FROM jobs WHERE status = ? AND parent_job_id IS NULL ORDER BY updated_at DESC').all(status);
    }
    return db.prepare('SELECT * FROM jobs WHERE parent_job_id IS NULL ORDER BY updated_at DESC').all();
  });

  safeHandle('db:jobs:get', (_event, id: number) => {
    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  });

  safeHandle('db:jobs:save', (_event, job: any) => {
    if (job.id) {
      return db
        .prepare(
          `UPDATE jobs SET
            name = ?, job_number = ?, client = ?, location = ?,
            bid_date = ?, start_date = ?, description = ?, status = ?,
            overhead_percent = ?, profit_percent = ?, bond_percent = ?,
            tax_percent = ?, notes = ?, bid_locked = ?,
            updated_at = datetime('now', 'localtime')
          WHERE id = ?`
        )
        .run(
          job.name, job.jobNumber, job.client, job.location,
          job.bidDate, job.startDate, job.description, job.status,
          job.overheadPercent, job.profitPercent, job.bondPercent,
          job.taxPercent, job.notes, job.bidLocked ? 1 : 0, job.id
        );
    } else {
      return db
        .prepare(
          `INSERT INTO jobs (name, job_number, client, location, bid_date, start_date, description, status, overhead_percent, profit_percent, bond_percent, tax_percent, notes, parent_job_id, change_order_number)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          job.name, job.jobNumber, job.client, job.location,
          job.bidDate, job.startDate, job.description,
          job.overheadPercent, job.profitPercent, job.bondPercent,
          job.taxPercent, job.notes,
          job.parentJobId || null, job.changeOrderNumber || null
        );
    }
  });

  safeHandle('db:jobs:delete', (_event, id: number) => {
    return db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  });

  safeHandle('db:jobs:duplicate', (_event, id: number, newName?: string, newBidDate?: string) => {
    const duplicate = db.transaction(() => {
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
      if (!job) return null;

      const newJob = db
        .prepare(
          `INSERT INTO jobs (name, job_number, client, location, bid_date, start_date, description, status, overhead_percent, profit_percent, bond_percent, tax_percent, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`
        )
        .run(
          newName || job.name + ' (Copy)', job.job_number, job.client, job.location,
          newBidDate ?? job.bid_date, job.start_date, job.description,
          job.overhead_percent, job.profit_percent, job.bond_percent,
          job.tax_percent, job.notes
        );
      const newJobId = Number(newJob.lastInsertRowid);

      // Copy bid sections and line items
      const sections = db.prepare('SELECT * FROM bid_sections WHERE job_id = ? ORDER BY sort_order').all(id) as any[];
      for (const section of sections) {
        const newSection = db
          .prepare('INSERT INTO bid_sections (job_id, name, sort_order) VALUES (?, ?, ?)')
          .run(newJobId, section.name, section.sort_order);
        const newSectionId = Number(newSection.lastInsertRowid);

        const items = db.prepare('SELECT * FROM bid_line_items WHERE section_id = ? ORDER BY sort_order').all(section.id) as any[];
        const insertItem = db.prepare(
          `INSERT INTO bid_line_items (
            section_id, job_id, description, quantity, unit, sort_order,
            material_id, material_unit_cost, material_total,
            crew_template_id, production_rate_id, labor_hours, labor_cost_per_hour, labor_total,
            equipment_id, equipment_cost_per_hour, equipment_hours, equipment_total,
            subcontractor_cost, unit_cost, total_cost, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const item of items) {
          insertItem.run(
            newSectionId, newJobId, item.description, item.quantity, item.unit, item.sort_order,
            item.material_id, item.material_unit_cost, item.material_total,
            item.crew_template_id, item.production_rate_id, item.labor_hours, item.labor_cost_per_hour, item.labor_total,
            item.equipment_id || null, item.equipment_cost_per_hour, item.equipment_hours, item.equipment_total,
            item.subcontractor_cost, item.unit_cost, item.total_cost, item.notes
          );
        }
      }

      // Copy trench profiles
      const profiles = db.prepare('SELECT * FROM trench_profiles WHERE job_id = ? ORDER BY sort_order').all(id) as any[];
      const insertProfile = db.prepare(
        `INSERT INTO trench_profiles (
          job_id, label, pipe_size_in, pipe_material, start_depth_ft,
          grade_pct, run_length_lf, trench_width_ft, bench_width_ft,
          bedding_type, backfill_type, sort_order,
          pipe_material_id, bedding_material_id, backfill_material_id, bedding_depth_ft
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const p of profiles) {
        insertProfile.run(
          newJobId, p.label, p.pipe_size_in, p.pipe_material, p.start_depth_ft,
          p.grade_pct, p.run_length_lf, p.trench_width_ft, p.bench_width_ft,
          p.bedding_type, p.backfill_type, p.sort_order,
          p.pipe_material_id, p.bedding_material_id, p.backfill_material_id, p.bedding_depth_ft
        );
      }

      logger.info('jobs', `Duplicated job ${id} -> ${newJobId}`);
      return { newJobId };
    });

    return duplicate();
  });

  // ================================================================
  // CHANGE ORDERS
  // ================================================================

  safeHandle('db:jobs:change-orders', (_event, parentJobId: number) => {
    return db.prepare(
      'SELECT * FROM jobs WHERE parent_job_id = ? ORDER BY change_order_number'
    ).all(parentJobId);
  });

  safeHandle('db:jobs:create-change-order', (_event, parentJobId: number) => {
    const parent = db.prepare('SELECT * FROM jobs WHERE id = ?').get(parentJobId) as any;
    if (!parent) return null;

    // Next CO number = max existing + 1
    const maxCO = db.prepare(
      'SELECT MAX(change_order_number) as max_co FROM jobs WHERE parent_job_id = ?'
    ).get(parentJobId) as any;
    const nextCO = (maxCO?.max_co || 0) + 1;

    const result = db.prepare(
      `INSERT INTO jobs (name, job_number, client, location, bid_date, start_date, description, status,
        overhead_percent, profit_percent, bond_percent, tax_percent, notes,
        parent_job_id, change_order_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `CO #${nextCO}`, parent.job_number, parent.client, parent.location,
      null, null, null, parent.overhead_percent, parent.profit_percent,
      parent.bond_percent, parent.tax_percent, null,
      parentJobId, nextCO
    );

    logger.info('jobs', `Created change order #${nextCO} for job ${parentJobId}`);
    return { newJobId: Number(result.lastInsertRowid), changeOrderNumber: nextCO };
  });

  safeHandle('db:jobs:summary', (_event, jobId: number) => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
    if (!job) return null;

    const totals = db
      .prepare(
        `SELECT
          COALESCE(SUM(material_total), 0) as material_total,
          COALESCE(SUM(labor_total), 0) as labor_total,
          COALESCE(SUM(equipment_total), 0) as equipment_total,
          COALESCE(SUM(subcontractor_cost), 0) as subcontractor_total,
          COALESCE(SUM(total_cost), 0) as direct_cost_total
        FROM bid_line_items WHERE job_id = ?`
      )
      .get(jobId) as any;

    const directCost = totals.direct_cost_total;
    const overhead = directCost * (job.overhead_percent / 100);
    const profit = directCost * (job.profit_percent / 100);
    const bond = directCost * ((job.bond_percent || 0) / 100);
    const tax = totals.material_total * ((job.tax_percent || 0) / 100);

    return {
      jobId,
      ...totals,
      overhead,
      profit,
      bond,
      tax,
      grandTotal: directCost + overhead + profit + bond + tax,
    };
  });

  safeHandle('db:jobs:summary-batch', (_event, jobIds: number[]) => {
    if (!jobIds.length) return [];
    const placeholders = jobIds.map(() => '?').join(',');

    const jobs = db.prepare(`SELECT * FROM jobs WHERE id IN (${placeholders})`).all(...jobIds) as any[];
    const jobMap = new Map(jobs.map((j: any) => [j.id, j]));

    const totalsRows = db.prepare(
      `SELECT job_id,
        COALESCE(SUM(material_total), 0) as material_total,
        COALESCE(SUM(labor_total), 0) as labor_total,
        COALESCE(SUM(equipment_total), 0) as equipment_total,
        COALESCE(SUM(subcontractor_cost), 0) as subcontractor_total,
        COALESCE(SUM(total_cost), 0) as direct_cost_total
      FROM bid_line_items WHERE job_id IN (${placeholders}) GROUP BY job_id`
    ).all(...jobIds) as any[];
    const totalsMap = new Map(totalsRows.map((t: any) => [t.job_id, t]));

    return jobIds.map((id) => {
      const job = jobMap.get(id);
      if (!job) return null;

      const totals = totalsMap.get(id) || {
        material_total: 0, labor_total: 0, equipment_total: 0,
        subcontractor_total: 0, direct_cost_total: 0,
      };

      const directCost = totals.direct_cost_total;
      const overhead = directCost * (job.overhead_percent / 100);
      const profit = directCost * (job.profit_percent / 100);
      const bond = directCost * ((job.bond_percent || 0) / 100);
      const tax = totals.material_total * ((job.tax_percent || 0) / 100);

      return {
        jobId: id,
        ...totals,
        overhead,
        profit,
        bond,
        tax,
        grandTotal: directCost + overhead + profit + bond + tax,
      };
    }).filter(Boolean);
  });

  // ================================================================
  // BID SECTIONS
  // ================================================================

  safeHandle('db:bid-sections:list', (_event, jobId: number) => {
    return db.prepare('SELECT * FROM bid_sections WHERE job_id = ? ORDER BY sort_order').all(jobId);
  });

  safeHandle('db:bid-sections:save', (_event, section: any) => {
    if (section.id) {
      return db
        .prepare('UPDATE bid_sections SET name = ?, sort_order = ? WHERE id = ?')
        .run(section.name, section.sortOrder, section.id);
    } else {
      return db
        .prepare('INSERT INTO bid_sections (job_id, name, sort_order) VALUES (?, ?, ?)')
        .run(section.jobId, section.name, section.sortOrder);
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
            subcontractor_cost = ?, unit_cost = ?, total_cost = ?, notes = ?
          WHERE id = ?`
        )
        .run(
          item.sectionId, item.jobId, item.description, item.quantity, item.unit, item.sortOrder,
          item.materialId, item.materialUnitCost, materialTotal,
          item.crewTemplateId, item.productionRateId, item.laborHours, item.laborCostPerHour, laborTotal,
          item.equipmentId || null, item.equipmentCostPerHour, item.equipmentHours, equipmentTotal,
          item.subcontractorCost || 0, unitCost, totalCost, item.notes,
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
            subcontractor_cost, unit_cost, total_cost, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          item.sectionId, item.jobId, item.description, item.quantity, item.unit, item.sortOrder,
          item.materialId, item.materialUnitCost, materialTotal,
          item.crewTemplateId, item.productionRateId, item.laborHours, item.laborCostPerHour, laborTotal,
          item.equipmentId || null, item.equipmentCostPerHour, item.equipmentHours, equipmentTotal,
          item.subcontractorCost || 0, unitCost, totalCost, item.notes
        );
    }
  });

  safeHandle('db:line-items:delete', (_event, id: number) => {
    return db.prepare('DELETE FROM bid_line_items WHERE id = ?').run(id);
  });

  // ================================================================
  // TRENCH PROFILES
  // ================================================================

  safeHandle('db:trench-profiles:list', (_event, jobId: number) => {
    return db.prepare('SELECT * FROM trench_profiles WHERE job_id = ? ORDER BY sort_order, id').all(jobId);
  });

  safeHandle('db:trench-profiles:save', (_event, profile: any) => {
    // Only store numeric IDs in the FK columns; string IDs like 'native' become NULL
    const intOrNull = (v: any) => (typeof v === 'number' ? v : null);

    if (profile.id) {
      db.prepare(
        `UPDATE trench_profiles SET label = ?, pipe_size_in = ?, pipe_material = ?, start_depth_ft = ?,
          grade_pct = ?, run_length_lf = ?, trench_width_ft = ?, bench_width_ft = ?,
          bedding_type = ?, backfill_type = ?, sort_order = ?,
          pipe_material_id = ?, bedding_material_id = ?, backfill_material_id = ?, bedding_depth_ft = ?,
          updated_at = datetime('now', 'localtime')
        WHERE id = ?`
      ).run(
        profile.label ?? '', profile.pipeSizeIn, profile.pipeMaterial ?? '', profile.startDepthFt,
        profile.gradePct, profile.runLengthLF, profile.trenchWidthFt, profile.benchWidthFt,
        profile.beddingType ?? '', profile.backfillType ?? '', profile.sortOrder ?? 0,
        intOrNull(profile.pipeMaterialId), intOrNull(profile.beddingMaterialId),
        intOrNull(profile.backfillMaterialId), profile.beddingDepthFt ?? 0.5,
        profile.id
      );
      return { id: profile.id };
    } else {
      const result = db.prepare(
        `INSERT INTO trench_profiles (job_id, label, pipe_size_in, pipe_material, start_depth_ft,
          grade_pct, run_length_lf, trench_width_ft, bench_width_ft, bedding_type, backfill_type, sort_order,
          pipe_material_id, bedding_material_id, backfill_material_id, bedding_depth_ft)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        profile.jobId, profile.label ?? '', profile.pipeSizeIn, profile.pipeMaterial ?? '', profile.startDepthFt,
        profile.gradePct, profile.runLengthLF, profile.trenchWidthFt, profile.benchWidthFt,
        profile.beddingType ?? '', profile.backfillType ?? '', profile.sortOrder ?? 0,
        intOrNull(profile.pipeMaterialId), intOrNull(profile.beddingMaterialId),
        intOrNull(profile.backfillMaterialId), profile.beddingDepthFt ?? 0.5
      );
      return { id: Number(result.lastInsertRowid) };
    }
  });

  safeHandle('db:trench-profiles:delete', (_event, id: number) => {
    return db.prepare('DELETE FROM trench_profiles WHERE id = ?').run(id);
  });

  safeHandle('db:trench-profiles:reorder', (_event, items: { id: number; sortOrder: number }[]) => {
    const update = db.prepare('UPDATE trench_profiles SET sort_order = ? WHERE id = ?');
    const reorder = db.transaction(() => {
      for (const item of items) {
        update.run(item.sortOrder, item.id);
      }
    });
    reorder();
  });

  // ================================================================
  // ASSEMBLIES
  // ================================================================

  safeHandle('db:assemblies:list', () => {
    const assemblies = db
      .prepare('SELECT * FROM assemblies WHERE is_active = 1 ORDER BY name')
      .all() as any[];

    return assemblies.map((a) => ({
      ...a,
      items: db
        .prepare(
          `SELECT ai.*, m.name as material_name, m.unit as material_unit, m.default_unit_cost as material_unit_cost
          FROM assembly_items ai
          JOIN materials m ON ai.material_id = m.id
          WHERE ai.assembly_id = ?`
        )
        .all(a.id),
    }));
  });

  safeHandle('db:assemblies:get', (_event, id: number) => {
    const assembly = db.prepare('SELECT * FROM assemblies WHERE id = ?').get(id) as any;
    if (!assembly) return null;
    assembly.items = db
      .prepare(
        `SELECT ai.*, m.name as material_name, m.unit as material_unit, m.default_unit_cost as material_unit_cost
        FROM assembly_items ai
        JOIN materials m ON ai.material_id = m.id
        WHERE ai.assembly_id = ?`
      )
      .all(id);
    return assembly;
  });

  safeHandle('db:assemblies:save', (_event, assembly: any) => {
    const saveAssembly = db.transaction(() => {
      let assemblyId: number;

      if (assembly.id) {
        db.prepare(
          `UPDATE assemblies SET name = ?, description = ?, unit = ?, notes = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
        ).run(assembly.name, assembly.description, assembly.unit, assembly.notes, assembly.id);
        assemblyId = assembly.id;
        db.prepare('DELETE FROM assembly_items WHERE assembly_id = ?').run(assemblyId);
      } else {
        const result = db
          .prepare('INSERT INTO assemblies (name, description, unit, notes) VALUES (?, ?, ?, ?)')
          .run(assembly.name, assembly.description, assembly.unit, assembly.notes);
        assemblyId = Number(result.lastInsertRowid);
      }

      const insertItem = db.prepare(
        'INSERT INTO assembly_items (assembly_id, material_id, quantity, notes) VALUES (?, ?, ?, ?)'
      );
      for (const item of assembly.items || []) {
        insertItem.run(assemblyId, item.materialId, item.quantity, item.notes || null);
      }

      return assemblyId;
    });

    return saveAssembly();
  });

  safeHandle('db:assemblies:delete', (_event, id: number) => {
    return db.prepare('UPDATE assemblies SET is_active = 0 WHERE id = ?').run(id);
  });

  // ================================================================
  // DATABASE BACKUP / RESTORE
  // These keep their existing { success, error } return shape
  // because the renderer UI already reads it. Logging is added.
  // ================================================================

  ipcMain.handle('db:export', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Export Database Backup',
      defaultPath: `BidSheet-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };

    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
      const srcPath = getDbPath();
      fs.copyFileSync(srcPath, result.filePath);

      const srcSize = fs.statSync(srcPath).size;
      const destSize = fs.statSync(result.filePath).size;
      if (destSize !== srcSize) {
        const msg = `Backup file size mismatch (expected ${srcSize}, got ${destSize})`;
        logger.error('db:export', msg);
        return { success: false, error: msg };
      }

      // Mark backup schema version as current so the reminder dismisses
      const currentVersion = (db.prepare('SELECT MAX(version) as version FROM schema_version').get() as any)?.version ?? 0;
      db.prepare('UPDATE app_settings SET last_backup_schema_version = ? WHERE id = 1').run(currentVersion);

      logger.info('db:export', `Backup saved to ${result.filePath} (${srcSize} bytes)`);
      return { success: true, path: result.filePath };
    } catch (err: any) {
      logger.error('db:export', 'Backup failed', err.stack || err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('db:restore', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Restore Database from Backup',
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };

    const backupPath = result.filePaths[0];
    try {
      const BetterSqlite3 = require('better-sqlite3');
      const testDb = new BetterSqlite3(backupPath, { readonly: true });
      const hasSettings = testDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'"
      ).get();
      testDb.close();

      if (!hasSettings) {
        logger.warn('db:restore', `Rejected invalid backup file: ${backupPath}`);
        return { success: false, error: 'This file is not a valid BidSheet database.' };
      }

      const dbPath = getDbPath();
      const walPath = dbPath + '-wal';
      const shmPath = dbPath + '-shm';

      const safetyPath = dbPath + '.pre-restore';
      db.pragma('wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(dbPath, safetyPath);

      db.close();

      try { fs.unlinkSync(walPath); } catch (_) {}
      try { fs.unlinkSync(shmPath); } catch (_) {}

      fs.copyFileSync(backupPath, dbPath);

      const srcSize = fs.statSync(backupPath).size;
      const destSize = fs.statSync(dbPath).size;
      if (destSize !== srcSize) {
        fs.copyFileSync(safetyPath, dbPath);
        try { fs.unlinkSync(safetyPath); } catch (_) {}
        const msg = 'Restore failed: file size mismatch after copy. Original database has been preserved.';
        logger.error('db:restore', msg);
        return { success: false, error: msg };
      }

      try { fs.unlinkSync(safetyPath); } catch (_) {}

      logger.info('db:restore', `Database restored from ${backupPath}. Relaunching.`);

      app.relaunch();
      app.exit(0);

      return { success: true };
    } catch (err: any) {
      logger.error('db:restore', 'Restore failed', err.stack || err.message);
      return { success: false, error: err.message };
    }
  });

  // ================================================================
  // QUICKBOOKS CSV EXPORT
  // ================================================================

  ipcMain.handle('export:quickbooks-csv', async (_event, jobId: number) => {
    const { generateEstimateCSV } = await import('./csv-export');

    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
    if (!job) return { success: false, error: 'Job not found.' };

    const sections = db.prepare('SELECT * FROM bid_sections WHERE job_id = ? ORDER BY sort_order').all(jobId) as any[];

    const lineItemsBySection: Record<number, any[]> = {};
    for (const section of sections) {
      lineItemsBySection[section.id] = db
        .prepare('SELECT * FROM bid_line_items WHERE section_id = ? ORDER BY sort_order')
        .all(section.id) as any[];
    }

    // Calculate summary (same logic as db:jobs:summary)
    const totals = db.prepare(
      `SELECT
        COALESCE(SUM(material_total), 0) as material_total,
        COALESCE(SUM(labor_total), 0) as labor_total,
        COALESCE(SUM(equipment_total), 0) as equipment_total,
        COALESCE(SUM(subcontractor_cost), 0) as subcontractor_total,
        COALESCE(SUM(total_cost), 0) as direct_cost_total
      FROM bid_line_items WHERE job_id = ?`
    ).get(jobId) as any;

    const directCost = totals.direct_cost_total;
    const summary = {
      overhead: directCost * (job.overhead_percent / 100),
      profit: directCost * (job.profit_percent / 100),
      bond: directCost * ((job.bond_percent || 0) / 100),
      tax: totals.material_total * ((job.tax_percent || 0) / 100),
    };

    const csvContent = generateEstimateCSV({ job, sections, lineItemsBySection, summary });

    const safeName = (job.job_number || job.name || 'estimate').replace(/[^a-zA-Z0-9_-]/g, '_');
    const result = await dialog.showSaveDialog({
      title: 'Export Estimate to QuickBooks CSV',
      defaultPath: `${safeName}-quickbooks.csv`,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };

    try {
      fs.writeFileSync(result.filePath, csvContent, 'utf-8');
      logger.info('export:quickbooks-csv', `Exported job ${jobId} to ${result.filePath}`);
      return { success: true, path: result.filePath };
    } catch (err: any) {
      logger.error('export:quickbooks-csv', 'Export failed', err.stack || err.message);
      return { success: false, error: err.message };
    }
  });

  // ================================================================
  // PDF BID EXPORT
  // ================================================================

  ipcMain.handle('jobs:export-pdf', async (_event, jobId: number) => {
    try {
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
      if (!job) throw new Error('Job not found.');

      const settings = db.prepare('SELECT * FROM app_settings WHERE id = 1').get() as any;

      const sections = db.prepare(
        'SELECT * FROM bid_sections WHERE job_id = ? ORDER BY sort_order'
      ).all(jobId) as any[];

      const lineItemsBySection: Record<number, any[]> = {};
      for (const section of sections) {
        lineItemsBySection[section.id] = db.prepare(
          'SELECT * FROM bid_line_items WHERE section_id = ? ORDER BY sort_order'
        ).all(section.id) as any[];
      }

      const totals = db.prepare(
        `SELECT
          COALESCE(SUM(material_total), 0) as material_total,
          COALESCE(SUM(labor_total), 0) as labor_total,
          COALESCE(SUM(equipment_total), 0) as equipment_total,
          COALESCE(SUM(subcontractor_cost), 0) as subcontractor_total,
          COALESCE(SUM(total_cost), 0) as direct_cost_total
        FROM bid_line_items WHERE job_id = ?`
      ).get(jobId) as any;

      const directCost = totals.direct_cost_total;
      const overheadPct = job.overhead_percent || 0;
      const profitPct = job.profit_percent || 0;
      const bondPct = job.bond_percent || 0;
      const taxPct = job.tax_percent || 0;
      const overhead = directCost * (overheadPct / 100);
      const profit = directCost * (profitPct / 100);
      const bond = directCost * (bondPct / 100);
      const tax = totals.material_total * (taxPct / 100);
      const grandTotal = directCost + overhead + profit + bond + tax;

      const html = buildBidPdfHtml({
        job, settings, sections, lineItemsBySection, totals,
        overhead, profit, bond, tax, grandTotal,
        overheadPct, profitPct, bondPct, taxPct,
      });

      // Create hidden BrowserWindow for PDF generation
      const win = new BrowserWindow({
        show: false,
        width: 816,
        height: 1056,
        webPreferences: { offscreen: true },
      });

      let pdfBuffer: Buffer;
      try {
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

        // Small delay to ensure rendering is complete
        await new Promise((resolve) => setTimeout(resolve, 300));

        pdfBuffer = await win.webContents.printToPDF({
          printBackground: true,
          pageSize: 'Letter',
          margins: { top: 0, bottom: 0, left: 0, right: 0 },
        });
      } finally {
        win.destroy();
      }

      const safeName = (job.job_number || job.name || 'bid').replace(/[^a-zA-Z0-9_-]/g, '_');
      const result = await dialog.showSaveDialog({
        title: 'Save Bid PDF',
        defaultPath: `${safeName}-bid.pdf`,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }

      fs.writeFileSync(result.filePath, pdfBuffer);
      logger.info('jobs:export-pdf', `Exported job ${jobId} to ${result.filePath}`);
      return { success: true, filePath: result.filePath };
    } catch (err: any) {
      logger.error('jobs:export-pdf', 'PDF export failed', err.stack || err.message);
      throw new Error(err.message || 'PDF export failed.');
    }
  });

  // ================================================================
  // CSV PRICE IMPORT
  // These also keep their existing return shapes with logging added.
  // ================================================================

  function readAndParseCsv(filePath: string): { headers: string[]; rows: Record<string, string>[]; fileName: string; error?: string } {
    const fileName = path.basename(filePath);
    try {
      let raw = fs.readFileSync(filePath, 'utf-8');

      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

      const firstLine = raw.split(/\r?\n/)[0] || '';
      const delimiter = firstLine.includes('\t') ? '\t' : ',';

      const rows = parseCsvString(raw, delimiter);
      if (rows.length === 0) {
        return { error: 'No data found in file.', headers: [], rows: [], fileName };
      }

      const headers = Object.keys(rows[0]);
      logger.info('csv:parse', `Parsed ${fileName}: ${rows.length} rows, ${headers.length} columns`);
      return { headers, rows, fileName };
    } catch (err: any) {
      logger.error('csv:parse', `Failed to read ${fileName}`, err.stack || err.message);
      return { error: `Failed to read file: ${err.message}`, headers: [], rows: [], fileName };
    }
  }

  ipcMain.handle('db:csv:open', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Price Sheet CSV',
      filters: [
        { name: 'CSV Files', extensions: ['csv', 'tsv', 'txt'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return readAndParseCsv(result.filePaths[0]);
  });

  safeHandle('db:csv:parse-path', (_event, filePath: string) => {
    // Resolve to absolute and verify the file actually exists on disk
    // (prevents path traversal via relative segments like ../)
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      return { error: 'File not found.', headers: [], rows: [], fileName: path.basename(resolved) };
    }
    const ext = path.extname(resolved).toLowerCase();
    if (!['.csv', '.tsv', '.txt'].includes(ext)) {
      return { error: 'Unsupported file type. Use .csv, .tsv, or .txt files.', headers: [], rows: [], fileName: path.basename(resolved) };
    }
    return readAndParseCsv(resolved);
  });

  ipcMain.handle(
    'db:materials:import-prices',
    (
      _event,
      updates: { materialId: number; newPrice: number; supplier?: string; partNumber?: string }[],
      source: string
    ) => {
      try {
        let updated = 0;
        let skipped = 0;

        const importAll = db.transaction(() => {
          const getMat = db.prepare('SELECT id, default_unit_cost FROM materials WHERE id = ?');
          const logPrice = db.prepare(
            'INSERT INTO price_updates (material_id, old_price, new_price, source) VALUES (?, ?, ?, ?)'
          );
          const updateMat = db.prepare(
            `UPDATE materials SET default_unit_cost = ?, last_price_update = datetime('now', 'localtime'),
              supplier = COALESCE(?, supplier), part_number = COALESCE(?, part_number)
            WHERE id = ?`
          );

          for (const u of updates) {
            const existing = getMat.get(u.materialId) as any;
            if (!existing) {
              skipped++;
              continue;
            }

            if (existing.default_unit_cost === u.newPrice) {
              skipped++;
              continue;
            }

            logPrice.run(u.materialId, existing.default_unit_cost, u.newPrice, source);
            updateMat.run(
              u.newPrice,
              u.supplier || null,
              u.partNumber || null,
              u.materialId
            );
            updated++;
          }
        });

        importAll();
        logger.info('csv:import', `Price import from "${source}": ${updated} updated, ${skipped} skipped`);
        return { updated, skipped };
      } catch (err: any) {
        logger.error('csv:import', 'Price import failed', err.stack || err.message);
        return { error: err.message, updated: 0, skipped: 0 };
      }
    }
  );

  // ================================================================
  // PLAN TAKEOFF
  // ================================================================

  ipcMain.handle('db:takeoff:open-pdf', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Plan Sheet PDF',
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const filePath = result.filePaths[0];
    try {
      // Read the PDF into a buffer so the renderer can pass it directly
      // to pdf.js.  This avoids file:// CORS issues in dev mode.
      const data = fs.readFileSync(filePath);
      return { filePath, data };
    } catch (err: any) {
      logger.error('takeoff:open-pdf', `Failed to read ${filePath}`, err.message);
      return null;
    }
  });

  safeHandle('db:takeoff:read-pdf', (_event, filePath: string) => {
    try {
      const data = fs.readFileSync(filePath);
      return { data };
    } catch (err: any) {
      logger.error('takeoff:read-pdf', `Failed to read ${filePath}`, err.message);
      return null;
    }
  });

  safeHandle('db:takeoff-settings:get', (_event, jobId: number) => {
    return db.prepare('SELECT * FROM takeoff_job_settings WHERE job_id = ?').get(jobId) || null;
  });

  safeHandle('db:takeoff-settings:save', (_event, settings: any) => {
    // Sanitize pdf_path: only store absolute paths (from native file dialog)
    if (settings.pdf_path) {
      settings.pdf_path = path.resolve(settings.pdf_path);
    }
    return db.prepare(`
      INSERT INTO takeoff_job_settings
        (job_id, pdf_path, scale_px_per_ft, scale_point1_x, scale_point1_y,
         scale_point2_x, scale_point2_y, scale_distance_ft, updated_at)
      VALUES
        (@job_id, @pdf_path, @scale_px_per_ft, @scale_point1_x, @scale_point1_y,
         @scale_point2_x, @scale_point2_y, @scale_distance_ft, datetime('now','localtime'))
      ON CONFLICT(job_id) DO UPDATE SET
        pdf_path          = @pdf_path,
        scale_px_per_ft   = @scale_px_per_ft,
        scale_point1_x    = @scale_point1_x,
        scale_point1_y    = @scale_point1_y,
        scale_point2_x    = @scale_point2_x,
        scale_point2_y    = @scale_point2_y,
        scale_distance_ft = @scale_distance_ft,
        updated_at        = datetime('now','localtime')
    `).run({
      job_id: settings.job_id,
      pdf_path: settings.pdf_path ?? null,
      scale_px_per_ft: settings.scale_px_per_ft ?? null,
      scale_point1_x: settings.scale_point1_x ?? null,
      scale_point1_y: settings.scale_point1_y ?? null,
      scale_point2_x: settings.scale_point2_x ?? null,
      scale_point2_y: settings.scale_point2_y ?? null,
      scale_distance_ft: settings.scale_distance_ft ?? null,
    });
  });

  // ---- Takeoff Page Scales ----

  safeHandle('db:takeoff-page-scale:get', (_event, jobId: number, pageNumber: number) => {
    return db.prepare(
      'SELECT * FROM takeoff_page_scales WHERE job_id = ? AND page_number = ?'
    ).get(jobId, pageNumber) || null;
  });

  safeHandle('db:takeoff-page-scale:save', (_event, data: any) => {
    return db.prepare(`
      INSERT INTO takeoff_page_scales
        (job_id, page_number, scale_px_per_ft, scale_point1_x, scale_point1_y,
         scale_point2_x, scale_point2_y, scale_distance_ft)
      VALUES
        (@job_id, @page_number, @scale_px_per_ft, @scale_point1_x, @scale_point1_y,
         @scale_point2_x, @scale_point2_y, @scale_distance_ft)
      ON CONFLICT(job_id, page_number) DO UPDATE SET
        scale_px_per_ft   = @scale_px_per_ft,
        scale_point1_x    = @scale_point1_x,
        scale_point1_y    = @scale_point1_y,
        scale_point2_x    = @scale_point2_x,
        scale_point2_y    = @scale_point2_y,
        scale_distance_ft = @scale_distance_ft
    `).run({
      job_id: data.job_id,
      page_number: data.page_number,
      scale_px_per_ft: data.scale_px_per_ft,
      scale_point1_x: data.scale_point1_x ?? null,
      scale_point1_y: data.scale_point1_y ?? null,
      scale_point2_x: data.scale_point2_x ?? null,
      scale_point2_y: data.scale_point2_y ?? null,
      scale_distance_ft: data.scale_distance_ft ?? null,
    });
  });

  safeHandle('db:takeoff-page-scale:list', (_event, jobId: number) => {
    return db.prepare(
      'SELECT page_number, scale_px_per_ft FROM takeoff_page_scales WHERE job_id = ?'
    ).all(jobId) as any[];
  });

  // ---- Takeoff Runs ----

  safeHandle('db:takeoff-runs:list', (_event, jobId: number) => {
    const runs = db.prepare('SELECT * FROM takeoff_runs WHERE job_id = ? ORDER BY sort_order').all(jobId) as any[];
    const pointsStmt = db.prepare('SELECT x_px, y_px FROM takeoff_points WHERE run_id = ? ORDER BY sort_order');
    return runs.map((r) => ({
      id: r.id,
      label: r.label,
      utilityType: r.utility_type,
      pipeSizeIn: r.pipe_size_in,
      pipeMaterial: r.pipe_material,
      pipeMaterialId: r.pipe_material_id,
      startDepthFt: r.start_depth_ft,
      gradePct: r.grade_pct,
      trenchWidthFt: r.trench_width_ft,
      benchWidthFt: r.bench_width_ft,
      beddingType: r.bedding_type,
      beddingDepthFt: r.bedding_depth_ft,
      beddingMaterialId: r.bedding_material_id,
      backfillType: r.backfill_type,
      backfillMaterialId: r.backfill_material_id,
      color: r.color,
      pdfPage: r.pdf_page,
      points: (pointsStmt.all(r.id) as any[]).map((p) => ({ x: p.x_px, y: p.y_px })),
    }));
  });

  safeHandle('db:takeoff-runs:save', (_event, run: any) => {
    const saveTx = db.transaction(() => {
      let runId: number;
      if (run.id && run.id > 0) {
        db.prepare(`
          UPDATE takeoff_runs SET
            label = ?, utility_type = ?, pipe_size_in = ?, pipe_material = ?,
            pipe_material_id = ?, start_depth_ft = ?, grade_pct = ?,
            trench_width_ft = ?, bench_width_ft = ?, bedding_type = ?,
            bedding_depth_ft = ?, bedding_material_id = ?, backfill_type = ?,
            backfill_material_id = ?, color = ?, sort_order = ?, pdf_page = ?,
            updated_at = datetime('now','localtime')
          WHERE id = ?
        `).run(
          run.label, run.utilityType, run.pipeSizeIn, run.pipeMaterial,
          run.pipeMaterialId ?? null, run.startDepthFt, run.gradePct,
          run.trenchWidthFt, run.benchWidthFt, run.beddingType,
          run.beddingDepthFt, run.beddingMaterialId ?? null, run.backfillType,
          run.backfillMaterialId ?? null, run.color, run.sortOrder ?? 0, run.pdfPage,
          run.id
        );
        runId = run.id;
      } else {
        const result = db.prepare(`
          INSERT INTO takeoff_runs
            (job_id, label, utility_type, pipe_size_in, pipe_material,
             pipe_material_id, start_depth_ft, grade_pct,
             trench_width_ft, bench_width_ft, bedding_type,
             bedding_depth_ft, bedding_material_id, backfill_type,
             backfill_material_id, color, sort_order, pdf_page)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          run.jobId, run.label, run.utilityType, run.pipeSizeIn, run.pipeMaterial,
          run.pipeMaterialId ?? null, run.startDepthFt, run.gradePct,
          run.trenchWidthFt, run.benchWidthFt, run.beddingType,
          run.beddingDepthFt, run.beddingMaterialId ?? null, run.backfillType,
          run.backfillMaterialId ?? null, run.color, run.sortOrder ?? 0, run.pdfPage
        );
        runId = Number(result.lastInsertRowid);
      }

      // Replace points
      db.prepare('DELETE FROM takeoff_points WHERE run_id = ?').run(runId);
      const insertPt = db.prepare('INSERT INTO takeoff_points (run_id, x_px, y_px, sort_order) VALUES (?, ?, ?, ?)');
      if (run.points) {
        for (let i = 0; i < run.points.length; i++) {
          insertPt.run(runId, run.points[i].x, run.points[i].y, i);
        }
      }

      return { id: runId };
    });
    return saveTx();
  });

  safeHandle('db:takeoff-runs:delete', (_event, id: number) => {
    return db.prepare('DELETE FROM takeoff_runs WHERE id = ?').run(id);
  });

  // ---- Takeoff Items (count items: fittings, structures, valves) ----

  safeHandle('db:takeoff-items:list', (_event, jobId: number) => {
    const items = db.prepare(`
      SELECT ti.*, m.name AS material_name
      FROM takeoff_items ti
      LEFT JOIN materials m ON m.id = ti.material_id
      WHERE ti.job_id = ?
      ORDER BY ti.pdf_page, ti.id
    `).all(jobId) as any[];
    return items.map((i) => ({
      id: i.id,
      jobId: i.job_id,
      materialId: i.material_id,
      materialName: i.material_name || 'Unknown',
      xPx: i.x_px,
      yPx: i.y_px,
      quantity: i.quantity,
      label: i.label,
      pdfPage: i.pdf_page,
      nearRunId: i.near_run_id,
    }));
  });

  safeHandle('db:takeoff-items:save', (_event, item: any) => {
    if (item.id && item.id > 0) {
      db.prepare(`
        UPDATE takeoff_items SET
          material_id = ?, x_px = ?, y_px = ?, quantity = ?,
          label = ?, pdf_page = ?, near_run_id = ?
        WHERE id = ?
      `).run(
        item.materialId, item.xPx, item.yPx, item.quantity ?? 1,
        item.label ?? '', item.pdfPage, item.nearRunId ?? null, item.id
      );
      return { id: item.id };
    } else {
      const result = db.prepare(`
        INSERT INTO takeoff_items
          (job_id, material_id, x_px, y_px, quantity, label, pdf_page, near_run_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        item.jobId, item.materialId, item.xPx, item.yPx,
        item.quantity ?? 1, item.label ?? '', item.pdfPage, item.nearRunId ?? null
      );
      return { id: Number(result.lastInsertRowid) };
    }
  });

  safeHandle('db:takeoff-items:delete', (_event, id: number) => {
    return db.prepare('DELETE FROM takeoff_items WHERE id = ?').run(id);
  });

  // ================================================================
  // SETTINGS
  // ================================================================

  safeHandle('db:settings:get', () => {
    return db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
  });

  safeHandle('db:settings:backup-reminder-needed', () => {
    const settings = db.prepare('SELECT last_backup_schema_version FROM app_settings WHERE id = 1').get() as any;
    const currentVersion = (db.prepare('SELECT MAX(version) as version FROM schema_version').get() as any)?.version ?? 0;
    return {
      needed: currentVersion > (settings?.last_backup_schema_version ?? 0),
      currentVersion,
      lastBackupVersion: settings?.last_backup_schema_version ?? 0,
    };
  });

  safeHandle('db:settings:dismiss-backup-reminder', () => {
    const currentVersion = (db.prepare('SELECT MAX(version) as version FROM schema_version').get() as any)?.version ?? 0;
    db.prepare('UPDATE app_settings SET last_backup_schema_version = ? WHERE id = 1').run(currentVersion);
    return { success: true };
  });

  safeHandle('db:settings:save', (_event, settings: any) => {
    return db
      .prepare(
        `UPDATE app_settings SET
          company_name = ?, company_address = ?, company_phone = ?,
          company_email = ?, company_logo = ?,
          default_overhead_percent = ?, default_profit_percent = ?,
          default_tax_percent = ?, default_bond_percent = ?,
          auto_lock_on_close = ?
        WHERE id = 1`
      )
      .run(
        settings.companyName, settings.companyAddress, settings.companyPhone,
        settings.companyEmail, settings.companyLogo,
        settings.defaultOverheadPercent, settings.defaultProfitPercent,
        settings.defaultTaxPercent, settings.defaultBondPercent,
        settings.autoLockOnClose ? 1 : 0
      );
  });

}

// ================================================================
// PDF HTML TEMPLATE BUILDER
// ================================================================

function fmtCurrency(val: number): string {
  return val.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escHtml(str: string): string {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

interface PdfData {
  job: any;
  settings: any;
  sections: any[];
  lineItemsBySection: Record<number, any[]>;
  totals: any;
  overhead: number;
  profit: number;
  bond: number;
  tax: number;
  grandTotal: number;
  overheadPct: number;
  profitPct: number;
  bondPct: number;
  taxPct: number;
}

function buildBidPdfHtml(data: PdfData): string {
  const { job, settings, sections, lineItemsBySection, totals,
    overhead, profit, bond, tax, grandTotal,
    overheadPct, profitPct, bondPct, taxPct } = data;

  const companyName = escHtml(settings?.company_name || '');
  const companyAddress = escHtml(settings?.company_address || '');
  const companyPhone = escHtml(settings?.company_phone || '');
  const companyEmail = escHtml(settings?.company_email || '');
  const companyLogo = settings?.company_logo || '';
  const hasLogo = companyLogo.startsWith('data:');

  const bidDate = job.bid_date
    ? new Date(job.bid_date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  // Build line items HTML
  let tableRows = '';
  for (const section of sections) {
    const items = lineItemsBySection[section.id] || [];
    // Section header row
    tableRows += `<tr class="section-header"><td colspan="5">${escHtml(section.name)}</td></tr>\n`;

    let sectionTotal = 0;
    items.forEach((item: any, idx: number) => {
      const rowClass = idx % 2 === 1 ? ' class="stripe"' : '';
      sectionTotal += item.total_cost || 0;
      tableRows += `<tr${rowClass}>
        <td class="desc">${escHtml(item.description)}</td>
        <td class="center">${escHtml(item.unit)}</td>
        <td class="center">${escHtml(String(item.quantity))}</td>
        <td class="right">${fmtCurrency(item.unit_cost)}</td>
        <td class="right">${fmtCurrency(item.total_cost)}</td>
      </tr>\n`;
    });

    // Section subtotal
    tableRows += `<tr class="section-subtotal">
      <td colspan="3"></td>
      <td class="right subtotal-label">Subtotal</td>
      <td class="right subtotal-val">${fmtCurrency(sectionTotal)}</td>
    </tr>\n`;
  }

  // Summary rows (omit zero-percent rows)
  let summaryRows = '';
  summaryRows += `<tr><td class="sum-label">Subtotal</td><td class="sum-val">${fmtCurrency(totals.direct_cost_total)}</td></tr>`;
  if (overheadPct > 0) {
    summaryRows += `<tr><td class="sum-label">Overhead (${overheadPct}%)</td><td class="sum-val">${fmtCurrency(overhead)}</td></tr>`;
  }
  if (profitPct > 0) {
    summaryRows += `<tr><td class="sum-label">Profit (${profitPct}%)</td><td class="sum-val">${fmtCurrency(profit)}</td></tr>`;
  }
  if (bondPct > 0) {
    summaryRows += `<tr><td class="sum-label">Bond (${bondPct}%)</td><td class="sum-val">${fmtCurrency(bond)}</td></tr>`;
  }
  if (taxPct > 0) {
    summaryRows += `<tr><td class="sum-label">Sales Tax (${taxPct}%)</td><td class="sum-val">${fmtCurrency(tax)}</td></tr>`;
  }
  summaryRows += `<tr class="total-row"><td class="sum-label">TOTAL BID AMOUNT</td><td class="sum-val">${fmtCurrency(grandTotal)}</td></tr>`;

  // Header right-side info parts
  const infoParts: string[] = [];
  if (companyAddress) infoParts.push(companyAddress);
  if (companyPhone) infoParts.push(companyPhone);
  if (companyEmail) infoParts.push(companyEmail);

  // Logo or company name in header
  const headerLeft = hasLogo
    ? `<img src="${escHtml(companyLogo)}" style="max-height:48px;max-width:160px;object-fit:contain;" />`
    : `<span style="color:#fff;font-weight:bold;font-size:15px;">${companyName}</span>`;

  const headerLeftRow2 = hasLogo
    ? `<span style="color:#E8A020;font-size:9px;">Underground Utility Contractor</span><br/><span style="color:#fff;font-weight:bold;font-size:12px;">${companyName}</span>`
    : `<span style="color:#E8A020;font-size:9px;">Underground Utility Contractor</span>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  @page { size: Letter; margin: 0.65in; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #1A1A2E;
    font-size: 9px;
    line-height: 1.4;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .header-table { width: 100%; border-collapse: collapse; background: #1A1A2E; }
  .header-table td { padding: 10px 14px; vertical-align: middle; }
  .header-right { text-align: right; color: #fff; font-size: 8px; }
  .gold-rule { border: none; border-top: 3px solid #E8A020; margin: 0; }
  .bid-title { font-weight: bold; color: #1A1A2E; font-size: 11px; margin: 8px 0 6px 0; }

  .info-strip { width: 100%; border-collapse: collapse; background: #F8F9FA; border-bottom: 1.5px solid #E8A020; }
  .info-strip td { padding: 6px 10px; vertical-align: top; }
  .info-label { font-size: 7.5px; color: #7F8C8D; font-weight: bold; text-transform: uppercase; margin-bottom: 2px; }
  .info-value { font-size: 9px; color: #1A1A2E; }

  .items-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  .items-table th {
    background: #1A1A2E; color: #fff; font-weight: bold; font-size: 8px;
    padding: 5px 6px; text-align: center; border: 0.25px solid #D5D8DC;
  }
  .items-table th.left { text-align: left; }
  .items-table td { padding: 5px 6px; border: 0.25px solid #D5D8DC; font-size: 8.5px; }
  .items-table .desc { text-align: left; padding-left: 12px; width: 44%; }
  .items-table .center { text-align: center; }
  .items-table .right { text-align: right; }

  .items-table .section-header td {
    background: #424949; color: #fff; font-weight: bold; font-size: 9px;
    padding: 5px 8px; border-top: 1px solid #E8A020;
  }
  .items-table tr.stripe td { background: #EAECEE; }
  .items-table .section-subtotal td {
    background: #F8F9FA; border-top: 0.5px solid #E8A020;
  }
  .subtotal-label { font-weight: bold; color: #424949; font-size: 8.5px; }
  .subtotal-val { font-weight: bold; font-size: 8.5px; }

  .col-unit { width: 8%; }
  .col-qty { width: 10%; }
  .col-uprice { width: 19%; }
  .col-amount { width: 19%; }

  .summary-wrap { display: flex; justify-content: flex-end; margin-top: 14px; }
  .summary-table { width: 40%; border-collapse: collapse; }
  .summary-table td { padding: 4px 8px; font-size: 9px; }
  .sum-label { text-align: right; color: #424949; }
  .sum-val { text-align: right; font-weight: 500; }
  .summary-table .total-row td {
    background: #1A1A2E; color: #fff; font-weight: bold; font-size: 11px;
    border-top: 2px solid #E8A020; padding: 6px 8px;
  }

  .footer-rule { border: none; border-top: 1px solid #D5D8DC; margin: 20px 0 6px 0; }
  .footer-note { font-size: 7.5px; color: #7F8C8D; }
</style>
</head>
<body>

<table class="header-table">
  <tr>
    <td>${headerLeft}</td>
    <td></td>
  </tr>
  <tr>
    <td>${headerLeftRow2}</td>
    <td class="header-right">${infoParts.join(' | ')}</td>
  </tr>
</table>
<hr class="gold-rule"/>
<div class="bid-title">BID PROPOSAL</div>

<table class="info-strip">
  <tr>
    <td>
      <div class="info-label">Project Name</div>
      <div class="info-value">${escHtml(job.name)}</div>
    </td>
    <td>
      <div class="info-label">Owner / Client</div>
      <div class="info-value">${escHtml(job.client || '')}</div>
    </td>
    <td>
      <div class="info-label">Bid Number</div>
      <div class="info-value">${escHtml(job.job_number || '')}</div>
    </td>
    <td>
      <div class="info-label">Date Submitted</div>
      <div class="info-value">${escHtml(bidDate)}</div>
    </td>
  </tr>
</table>

<table class="items-table">
  <thead>
    <tr>
      <th class="left" style="width:44%">Description</th>
      <th class="col-unit">Unit</th>
      <th class="col-qty">Qty</th>
      <th class="col-uprice">Unit Price</th>
      <th class="col-amount">Amount</th>
    </tr>
  </thead>
  <tbody>
    ${tableRows}
  </tbody>
</table>

<div class="summary-wrap">
  <table class="summary-table">
    ${summaryRows}
  </table>
</div>

<hr class="footer-rule"/>
<div class="footer-note">
  This bid is valid for 60 days from date of submission. Unit prices include all labor, materials, equipment, and incidentals unless noted. Permit fees by owner.
</div>

</body>
</html>`;
}

// ================================================================
// CSV PARSER
// Handles: quoted fields, escaped quotes, commas inside quotes,
// CRLF/LF line endings, BOM, empty fields, tab-delimited.
// ================================================================

function parseCsvString(raw: string, delimiter: string): Record<string, string>[] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < raw.length) {
    const ch = raw[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < raw.length && raw[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"' && field.length === 0) {
        inQuotes = true;
        i++;
      } else if (ch === delimiter) {
        current.push(field.trim());
        field = '';
        i++;
      } else if (ch === '\r') {
        current.push(field.trim());
        field = '';
        rows.push(current);
        current = [];
        i++;
        if (i < raw.length && raw[i] === '\n') i++;
      } else if (ch === '\n') {
        current.push(field.trim());
        field = '';
        rows.push(current);
        current = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  if (field || current.length > 0) {
    current.push(field.trim());
    rows.push(current);
  }

  const nonEmpty = rows.filter((r) => r.some((cell) => cell.length > 0));
  if (nonEmpty.length < 2) return [];

  const headers = nonEmpty[0];
  const dataRows: Record<string, string>[] = [];

  for (let r = 1; r < nonEmpty.length; r++) {
    const row = nonEmpty[r];
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = c < row.length ? row[c] : '';
    }
    dataRows.push(obj);
  }

  return dataRows;
}
