import { ipcMain, dialog, app } from 'electron';
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
      const friendly = friendlyMessage(err);
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
      return db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY updated_at DESC').all(status);
    }
    return db.prepare('SELECT * FROM jobs ORDER BY updated_at DESC').all();
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
          `INSERT INTO jobs (name, job_number, client, location, bid_date, start_date, description, status, overhead_percent, profit_percent, bond_percent, tax_percent, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`
        )
        .run(
          job.name, job.jobNumber, job.client, job.location,
          job.bidDate, job.startDate, job.description,
          job.overheadPercent, job.profitPercent, job.bondPercent,
          job.taxPercent, job.notes
        );
    }
  });

  safeHandle('db:jobs:delete', (_event, id: number) => {
    return db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  });

  safeHandle('db:jobs:duplicate', (_event, id: number) => {
    const duplicate = db.transaction(() => {
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
      if (!job) return null;

      const newJob = db
        .prepare(
          `INSERT INTO jobs (name, job_number, client, location, bid_date, start_date, description, status, overhead_percent, profit_percent, bond_percent, tax_percent, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`
        )
        .run(
          job.name + ' (Copy)', job.job_number, job.client, job.location,
          job.bid_date, job.start_date, job.description,
          job.overhead_percent, job.profit_percent, job.bond_percent,
          job.tax_percent, job.notes
        );
      const newJobId = Number(newJob.lastInsertRowid);

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

      return { newJobId };
    });

    return duplicate();
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
    if (profile.id) {
      db.prepare(
        `UPDATE trench_profiles SET label = ?, pipe_size_in = ?, pipe_material = ?, start_depth_ft = ?,
          grade_pct = ?, run_length_lf = ?, trench_width_ft = ?, bench_width_ft = ?,
          bedding_type = ?, backfill_type = ?, sort_order = ?,
          updated_at = datetime('now', 'localtime')
        WHERE id = ?`
      ).run(
        profile.label, profile.pipeSizeIn, profile.pipeMaterial, profile.startDepthFt,
        profile.gradePct, profile.runLengthLF, profile.trenchWidthFt, profile.benchWidthFt,
        profile.beddingType, profile.backfillType, profile.sortOrder ?? 0,
        profile.id
      );
      return { id: profile.id };
    } else {
      const result = db.prepare(
        `INSERT INTO trench_profiles (job_id, label, pipe_size_in, pipe_material, start_depth_ft,
          grade_pct, run_length_lf, trench_width_ft, bench_width_ft, bedding_type, backfill_type, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        profile.jobId, profile.label, profile.pipeSizeIn, profile.pipeMaterial, profile.startDepthFt,
        profile.gradePct, profile.runLengthLF, profile.trenchWidthFt, profile.benchWidthFt,
        profile.beddingType, profile.backfillType, profile.sortOrder ?? 0
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
    const ext = path.extname(filePath).toLowerCase();
    if (!['.csv', '.tsv', '.txt'].includes(ext)) {
      return { error: 'Unsupported file type. Use .csv, .tsv, or .txt files.', headers: [], rows: [], fileName: path.basename(filePath) };
    }
    return readAndParseCsv(filePath);
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
  // SETTINGS
  // ================================================================

  safeHandle('db:settings:get', () => {
    return db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
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
