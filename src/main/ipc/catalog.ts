import { dialog, app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { getDbPath, isSetupComplete, seedDatabase } from '../database';
import { logger } from '../logger';
import { TradeType } from '../../shared/constants/seed-data';
import { computeBidSummaryFromSections } from '../../shared/bidCalc';
import { safeHandle, getSectionCostRows } from './shared';

import { createMaterialCategory, updateMaterialCategory, getMaterialCategoryUsage, listMaterialCategoriesWithUsage, deleteMaterialCategory } from './material-categories';

export function registerCatalogHandlers(db: Database.Database): void {
  // ================================================================
  // MATERIAL CATEGORIES
  // ================================================================

  safeHandle('db:material-categories:list', () => {
    return db.prepare('SELECT * FROM material_categories ORDER BY name').all();
  });

  safeHandle('db:material-categories:management', () => {
    return listMaterialCategoriesWithUsage(db);
  });

  safeHandle('db:material-categories:save', (_event, payload: any) => {
    if (payload.id) {
      return updateMaterialCategory(db, payload);
    }
    return createMaterialCategory(db, payload);
  });

  safeHandle('db:material-categories:usage', (_event, categoryId: number) => {
    return getMaterialCategoryUsage(db, categoryId);
  });

  safeHandle('db:material-categories:delete', (_event, payload: any) => {
    return deleteMaterialCategory(db, payload);
  });

  safeHandle('db:materials:reassign-category', (_event, materialIds: number[], targetCategoryId: number) => {
    const stmt = db.prepare('UPDATE materials SET category_id = ? WHERE id = ?');
    const tx = db.transaction(() => {
      for (const id of materialIds) {
        stmt.run(targetCategoryId, id);
      }
    });
    tx();
    return { changes: materialIds.length, lastInsertRowid: 0 };
  });

  // ================================================================
  // MATERIALS
  // ================================================================

  safeHandle('db:materials:list', (_event, categoryId?: number, includeInactive?: boolean) => {
    // Interpolated SQL fragments are fixed strings chosen by a boolean —
    // user-supplied values only ever bind as ? parameters.
    const activeFilter = includeInactive ? '' : 'AND is_active = 1';
    if (categoryId) {
      return db
        .prepare(`SELECT * FROM materials WHERE category_id = ? ${activeFilter} ORDER BY name`)
        .all(categoryId);
    }
    return db.prepare(`SELECT * FROM materials WHERE 1=1 ${activeFilter} ORDER BY name`).all();
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
            last_price_update = datetime('now', 'localtime'), notes = ?, aliases = ?, is_active = ?,
            tons_per_cy = ?, cost_per_cy = ?
          WHERE id = ?`
        )
        .run(
          material.categoryId, material.name, material.description,
          material.unit, material.defaultUnitCost, material.supplier,
          material.partNumber, material.notes, material.aliases || null,
          material.isActive ? 1 : 0, material.tonsPerCy || null,
          material.costPerCy || null, material.id
        );
    } else {
      return db
        .prepare(
          `INSERT INTO materials (category_id, name, description, unit, default_unit_cost, supplier, part_number, notes, aliases, is_active, tons_per_cy, cost_per_cy)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
        )
        .run(
          material.categoryId, material.name, material.description,
          material.unit, material.defaultUnitCost, material.supplier,
          material.partNumber, material.notes, material.aliases || null,
          material.tonsPerCy || null, material.costPerCy || null
        );
    }
  });

  safeHandle('db:materials:delete', (_event, id: number) => {
    return db.prepare('UPDATE materials SET is_active = 0 WHERE id = ?').run(id);
  });

  safeHandle('db:materials:restore', (_event, id: number) => {
    return db.prepare('UPDATE materials SET is_active = 1 WHERE id = ?').run(id);
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

        // A set density links the per-CY price to the per-TON price;
        // keep them in sync on every price change
        db.prepare(
          `UPDATE materials SET default_unit_cost = ?, last_price_update = datetime('now', 'localtime'),
            cost_per_cy = CASE WHEN tons_per_cy > 0 THEN round(? * tons_per_cy, 2) ELSE cost_per_cy END
          WHERE id = ?`
        ).run(newPrice, newPrice, id);
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

  safeHandle('db:equipment:list', (_event, includeInactive?: boolean) => {
    const activeFilter = includeInactive ? '' : 'WHERE is_active = 1';
    return db.prepare(`SELECT * FROM equipment ${activeFilter} ORDER BY category, name`).all();
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

  safeHandle('db:equipment:restore', (_event, id: number) => {
    return db.prepare('UPDATE equipment SET is_active = 1 WHERE id = ?').run(id);
  });

  // ================================================================
  // ASSEMBLIES
  // ================================================================

  safeHandle('db:assemblies:list', () => {
    const assemblies = db
      .prepare(
        `SELECT a.*,
          pr.description AS production_rate_desc, pr.rate_per_hour AS production_rate_per_hour,
          ct.name AS crew_name, eq.name AS equipment_name, eq.hourly_rate AS equipment_hourly_rate
        FROM assemblies a
        LEFT JOIN production_rates pr ON a.production_rate_id = pr.id
        LEFT JOIN crew_templates ct ON a.crew_template_id = ct.id
        LEFT JOIN equipment eq ON a.equipment_id = eq.id
        WHERE a.is_active = 1 ORDER BY a.name`
      )
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
          `UPDATE assemblies SET name = ?, description = ?, unit = ?, notes = ?,
            production_rate_id = ?, crew_template_id = ?, equipment_id = ?, equipment_hours_per_unit = ?,
            updated_at = datetime('now', 'localtime') WHERE id = ?`
        ).run(assembly.name, assembly.description, assembly.unit, assembly.notes,
          assembly.productionRateId ?? null, assembly.crewTemplateId ?? null,
          assembly.equipmentId ?? null, assembly.equipmentHoursPerUnit ?? 0, assembly.id);
        assemblyId = assembly.id;
        db.prepare('DELETE FROM assembly_items WHERE assembly_id = ?').run(assemblyId);
      } else {
        const result = db
          .prepare(
            `INSERT INTO assemblies
              (name, description, unit, notes, production_rate_id, crew_template_id, equipment_id, equipment_hours_per_unit)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(assembly.name, assembly.description, assembly.unit, assembly.notes,
            assembly.productionRateId ?? null, assembly.crewTemplateId ?? null,
            assembly.equipmentId ?? null, assembly.equipmentHoursPerUnit ?? 0);
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

}
