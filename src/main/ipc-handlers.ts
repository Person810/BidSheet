import { ipcMain, dialog, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { getDbPath } from './database';
import type Database from 'better-sqlite3';
import { isSetupComplete, seedDatabase } from './database';
import { TradeType } from '../shared/constants/seed-data';

export function registerIpcHandlers(db: Database.Database): void {
  // ================================================================
  // SETUP
  // ================================================================

  ipcMain.handle('db:setup:is-complete', () => {
    return isSetupComplete(db);
  });

  ipcMain.handle(
    'db:setup:run',
    (_event, trades: string[], includeBallparkPrices: boolean, companyName: string) => {
      seedDatabase(db, trades as TradeType[], includeBallparkPrices, companyName);
      return { success: true };
    }
  );

  // ================================================================
  // MATERIAL CATEGORIES
  // ================================================================

  ipcMain.handle('db:material-categories:list', () => {
    return db.prepare('SELECT * FROM material_categories ORDER BY name').all();
  });

  // ================================================================
  // MATERIALS
  // ================================================================

  ipcMain.handle('db:materials:list', (_event, categoryId?: number) => {
    if (categoryId) {
      return db
        .prepare('SELECT * FROM materials WHERE category_id = ? AND is_active = 1 ORDER BY name')
        .all(categoryId);
    }
    return db.prepare('SELECT * FROM materials WHERE is_active = 1 ORDER BY name').all();
  });

  ipcMain.handle('db:materials:get', (_event, id: number) => {
    return db.prepare('SELECT * FROM materials WHERE id = ?').get(id);
  });

  ipcMain.handle('db:materials:save', (_event, material: any) => {
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

  ipcMain.handle('db:materials:delete', (_event, id: number) => {
    return db.prepare('UPDATE materials SET is_active = 0 WHERE id = ?').run(id);
  });

  ipcMain.handle(
    'db:materials:update-price',
    (_event, id: number, newPrice: number, source: string) => {
      const material = db.prepare('SELECT default_unit_cost FROM materials WHERE id = ?').get(id) as any;
      if (!material) return null;

      const updatePrice = db.transaction(() => {
        // Log the price change
        db.prepare(
          `INSERT INTO price_updates (material_id, old_price, new_price, source) VALUES (?, ?, ?, ?)`
        ).run(id, material.default_unit_cost, newPrice, source);

        // Update the material
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

  ipcMain.handle('db:labor-roles:list', () => {
    return db.prepare('SELECT * FROM labor_roles ORDER BY name').all();
  });

  ipcMain.handle('db:labor-roles:save', (_event, role: any) => {
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

  ipcMain.handle('db:crew-templates:list', () => {
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

  ipcMain.handle('db:crew-templates:get', (_event, id: number) => {
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

  ipcMain.handle('db:crew-templates:save', (_event, template: any) => {
    const saveTemplate = db.transaction(() => {
      let templateId: number;

      if (template.id) {
        db.prepare('UPDATE crew_templates SET name = ?, description = ? WHERE id = ?').run(
          template.name, template.description, template.id
        );
        templateId = template.id;
        // Clear existing members and re-insert
        db.prepare('DELETE FROM crew_members WHERE crew_template_id = ?').run(templateId);
      } else {
        const result = db
          .prepare('INSERT INTO crew_templates (name, description) VALUES (?, ?)')
          .run(template.name, template.description);
        templateId = Number(result.lastInsertRowid);
      }

      // Insert members
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

  ipcMain.handle('db:production-rates:list', () => {
    return db
      .prepare(
        `SELECT pr.*, ct.name as crew_name
        FROM production_rates pr
        JOIN crew_templates ct ON pr.crew_template_id = ct.id
        ORDER BY pr.description`
      )
      .all();
  });

  ipcMain.handle('db:production-rates:save', (_event, rate: any) => {
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

  ipcMain.handle('db:equipment:list', () => {
    return db.prepare('SELECT * FROM equipment WHERE is_active = 1 ORDER BY category, name').all();
  });

  ipcMain.handle('db:equipment:save', (_event, equip: any) => {
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

  ipcMain.handle('db:equipment:delete', (_event, id: number) => {
    return db.prepare('UPDATE equipment SET is_active = 0 WHERE id = ?').run(id);
  });

  // ================================================================
  // JOBS
  // ================================================================

  ipcMain.handle('db:jobs:list', (_event, status?: string) => {
    if (status) {
      return db.prepare('SELECT * FROM jobs WHERE status = ? ORDER BY updated_at DESC').all(status);
    }
    return db.prepare('SELECT * FROM jobs ORDER BY updated_at DESC').all();
  });

  ipcMain.handle('db:jobs:get', (_event, id: number) => {
    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  });

  ipcMain.handle('db:jobs:save', (_event, job: any) => {
    if (job.id) {
      return db
        .prepare(
          `UPDATE jobs SET
            name = ?, job_number = ?, client = ?, location = ?,
            bid_date = ?, start_date = ?, description = ?, status = ?,
            overhead_percent = ?, profit_percent = ?, bond_percent = ?,
            tax_percent = ?, notes = ?, updated_at = datetime('now', 'localtime')
          WHERE id = ?`
        )
        .run(
          job.name, job.jobNumber, job.client, job.location,
          job.bidDate, job.startDate, job.description, job.status,
          job.overheadPercent, job.profitPercent, job.bondPercent,
          job.taxPercent, job.notes, job.id
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

  ipcMain.handle('db:jobs:delete', (_event, id: number) => {
    return db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
  });

  ipcMain.handle('db:jobs:duplicate', (_event, id: number) => {
    const duplicate = db.transaction(() => {
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
      if (!job) return null;

      // Create new job as draft copy
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

      // Copy sections
      const sections = db.prepare('SELECT * FROM bid_sections WHERE job_id = ? ORDER BY sort_order').all(id) as any[];
      for (const section of sections) {
        const newSection = db
          .prepare('INSERT INTO bid_sections (job_id, name, sort_order) VALUES (?, ?, ?)')
          .run(newJobId, section.name, section.sort_order);
        const newSectionId = Number(newSection.lastInsertRowid);

        // Copy line items in this section
        const items = db.prepare('SELECT * FROM bid_line_items WHERE section_id = ? ORDER BY sort_order').all(section.id) as any[];
        const insertItem = db.prepare(
          `INSERT INTO bid_line_items (
            section_id, job_id, description, quantity, unit, sort_order,
            material_id, material_unit_cost, material_total,
            crew_template_id, production_rate_id, labor_hours, labor_cost_per_hour, labor_total,
            equipment_cost_per_hour, equipment_hours, equipment_total,
            subcontractor_cost, unit_cost, total_cost, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const item of items) {
          insertItem.run(
            newSectionId, newJobId, item.description, item.quantity, item.unit, item.sort_order,
            item.material_id, item.material_unit_cost, item.material_total,
            item.crew_template_id, item.production_rate_id, item.labor_hours, item.labor_cost_per_hour, item.labor_total,
            item.equipment_cost_per_hour, item.equipment_hours, item.equipment_total,
            item.subcontractor_cost, item.unit_cost, item.total_cost, item.notes
          );
        }
      }

      return { newJobId };
    });

    return duplicate();
  });

  ipcMain.handle('db:jobs:summary', (_event, jobId: number) => {
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

  ipcMain.handle('db:bid-sections:list', (_event, jobId: number) => {
    return db.prepare('SELECT * FROM bid_sections WHERE job_id = ? ORDER BY sort_order').all(jobId);
  });

  ipcMain.handle('db:bid-sections:save', (_event, section: any) => {
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

  ipcMain.handle('db:bid-sections:delete', (_event, id: number) => {
    return db.prepare('DELETE FROM bid_sections WHERE id = ?').run(id);
  });

  // ================================================================
  // BID LINE ITEMS
  // ================================================================

  ipcMain.handle('db:line-items:list', (_event, sectionId: number) => {
    return db
      .prepare('SELECT * FROM bid_line_items WHERE section_id = ? ORDER BY sort_order')
      .all(sectionId);
  });

  ipcMain.handle('db:line-items:save', (_event, item: any) => {
    // Auto-calculate totals
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
            equipment_cost_per_hour = ?, equipment_hours = ?, equipment_total = ?,
            subcontractor_cost = ?, unit_cost = ?, total_cost = ?, notes = ?
          WHERE id = ?`
        )
        .run(
          item.sectionId, item.jobId, item.description, item.quantity, item.unit, item.sortOrder,
          item.materialId, item.materialUnitCost, materialTotal,
          item.crewTemplateId, item.productionRateId, item.laborHours, item.laborCostPerHour, laborTotal,
          item.equipmentCostPerHour, item.equipmentHours, equipmentTotal,
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
            equipment_cost_per_hour, equipment_hours, equipment_total,
            subcontractor_cost, unit_cost, total_cost, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          item.sectionId, item.jobId, item.description, item.quantity, item.unit, item.sortOrder,
          item.materialId, item.materialUnitCost, materialTotal,
          item.crewTemplateId, item.productionRateId, item.laborHours, item.laborCostPerHour, laborTotal,
          item.equipmentCostPerHour, item.equipmentHours, equipmentTotal,
          item.subcontractorCost || 0, unitCost, totalCost, item.notes
        );
    }
  });

  ipcMain.handle('db:line-items:delete', (_event, id: number) => {
    return db.prepare('DELETE FROM bid_line_items WHERE id = ?').run(id);
  });

  // ================================================================
  // ASSEMBLIES
  // ================================================================

  ipcMain.handle('db:assemblies:list', () => {
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

  ipcMain.handle('db:assemblies:get', (_event, id: number) => {
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

  ipcMain.handle('db:assemblies:save', (_event, assembly: any) => {
    const saveAssembly = db.transaction(() => {
      let assemblyId: number;

      if (assembly.id) {
        db.prepare(
          `UPDATE assemblies SET name = ?, description = ?, unit = ?, notes = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
        ).run(assembly.name, assembly.description, assembly.unit, assembly.notes, assembly.id);
        assemblyId = assembly.id;
        // Clear existing items and re-insert
        db.prepare('DELETE FROM assembly_items WHERE assembly_id = ?').run(assemblyId);
      } else {
        const result = db
          .prepare('INSERT INTO assemblies (name, description, unit, notes) VALUES (?, ?, ?, ?)')
          .run(assembly.name, assembly.description, assembly.unit, assembly.notes);
        assemblyId = Number(result.lastInsertRowid);
      }

      // Insert items
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

  ipcMain.handle('db:assemblies:delete', (_event, id: number) => {
    return db.prepare('UPDATE assemblies SET is_active = 0 WHERE id = ?').run(id);
  });

  // ================================================================
  // DATABASE BACKUP / RESTORE
  // ================================================================

  ipcMain.handle('db:export', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Export Database Backup',
      defaultPath: `BidSheet-backup-${new Date().toISOString().slice(0, 10)}.db`,
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };

    try {
      // Checkpoint WAL to flush pending writes into the main db file
      db.pragma('wal_checkpoint(TRUNCATE)');
      const srcPath = getDbPath();
      fs.copyFileSync(srcPath, result.filePath);

      // Verify the backup file exists and matches the source size
      const srcSize = fs.statSync(srcPath).size;
      const destSize = fs.statSync(result.filePath).size;
      if (destSize !== srcSize) {
        return { success: false, error: `Backup file size mismatch (expected ${srcSize}, got ${destSize})` };
      }

      return { success: true, path: result.filePath };
    } catch (err: any) {
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
      // Validate: open the backup file and check it has our app_settings table
      const BetterSqlite3 = require('better-sqlite3');
      const testDb = new BetterSqlite3(backupPath, { readonly: true });
      const hasSettings = testDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='app_settings'"
      ).get();
      testDb.close();

      if (!hasSettings) {
        return { success: false, error: 'This file is not a valid BidSheet database.' };
      }

      const dbPath = getDbPath();
      const walPath = dbPath + '-wal';
      const shmPath = dbPath + '-shm';

      // Save a safety copy of the current DB before overwriting
      const safetyPath = dbPath + '.pre-restore';
      db.pragma('wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(dbPath, safetyPath);

      // Close current db so we can overwrite it
      db.close();

      // Remove WAL/SHM sidecar files — leftover WAL from the old DB
      // would corrupt the restored database
      try { fs.unlinkSync(walPath); } catch (_) {}
      try { fs.unlinkSync(shmPath); } catch (_) {}

      // Copy backup over the main db file
      fs.copyFileSync(backupPath, dbPath);

      // Verify size matches
      const srcSize = fs.statSync(backupPath).size;
      const destSize = fs.statSync(dbPath).size;
      if (destSize !== srcSize) {
        // Restore failed — put the safety copy back
        fs.copyFileSync(safetyPath, dbPath);
        try { fs.unlinkSync(safetyPath); } catch (_) {}
        return { success: false, error: 'Restore failed: file size mismatch after copy. Original database has been preserved.' };
      }

      // Clean up safety copy on success
      try { fs.unlinkSync(safetyPath); } catch (_) {}

      // Relaunch the app so it picks up the new database
      // (migrations will run on startup and handle any schema differences)
      app.relaunch();
      app.exit(0);

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ================================================================
  // CSV PRICE IMPORT
  // ================================================================

  // Shared CSV reading logic used by both dialog picker and drag-and-drop
  function readAndParseCsv(filePath: string): { headers: string[]; rows: Record<string, string>[]; fileName: string; error?: string } {
    const fileName = path.basename(filePath);
    try {
      let raw = fs.readFileSync(filePath, 'utf-8');

      // Strip BOM if present
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

      // Detect delimiter: tab-separated vs comma-separated
      const firstLine = raw.split(/\r?\n/)[0] || '';
      const delimiter = firstLine.includes('\t') ? '\t' : ',';

      const rows = parseCsvString(raw, delimiter);
      if (rows.length === 0) {
        return { error: 'No data found in file.', headers: [], rows: [], fileName };
      }

      const headers = Object.keys(rows[0]);
      return { headers, rows, fileName };
    } catch (err: any) {
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

  ipcMain.handle('db:csv:parse-path', (_event, filePath: string) => {
    // Validate extension before reading
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

            // Log price change for audit trail
            logPrice.run(u.materialId, existing.default_unit_cost, u.newPrice, source);

            // Update material price (and optionally supplier/part#)
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
        return { updated, skipped };
      } catch (err: any) {
        return { error: err.message, updated: 0, skipped: 0 };
      }
    }
  );

  // ================================================================
  // SETTINGS
  // ================================================================

  ipcMain.handle('db:settings:get', () => {
    return db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
  });

  ipcMain.handle('db:settings:save', (_event, settings: any) => {
    return db
      .prepare(
        `UPDATE app_settings SET
          company_name = ?, company_address = ?, company_phone = ?,
          company_email = ?, company_logo = ?,
          default_overhead_percent = ?, default_profit_percent = ?,
          default_tax_percent = ?, default_bond_percent = ?
        WHERE id = 1`
      )
      .run(
        settings.companyName, settings.companyAddress, settings.companyPhone,
        settings.companyEmail, settings.companyLogo,
        settings.defaultOverheadPercent, settings.defaultProfitPercent,
        settings.defaultTaxPercent, settings.defaultBondPercent
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
        // Peek ahead: escaped quote ("") or end of quoted field
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
        // Only enter quote mode at the START of a field (RFC 4180).
        // A " mid-field (e.g. 8" pipe) is a literal character.
        inQuotes = true;
        i++;
      } else if (ch === delimiter) {
        current.push(field.trim());
        field = '';
        i++;
      } else if (ch === '\r') {
        // CRLF or bare CR
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

  // Last field / last row
  if (field || current.length > 0) {
    current.push(field.trim());
    rows.push(current);
  }

  // Filter out completely empty rows
  const nonEmpty = rows.filter((r) => r.some((cell) => cell.length > 0));
  if (nonEmpty.length < 2) return []; // need header + at least one data row

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
