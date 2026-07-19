import { dialog, app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { getDbPath, isSetupComplete, seedDatabase } from '../database';
import { logger } from '../logger';
import { TradeType } from '../../shared/constants/seed-data';
import { computeBidSummaryFromSections } from '../../shared/bidCalc';
import { nextJobNumber } from '../../shared/jobNumbering';
import { safeHandle, getSectionCostRows, getIndirectTotal } from './shared';
import { removeJobFiles } from './documents';

export function registerJobHandlers(db: Database.Database): void {
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
            tax_percent = ?, escalation_percent = ?, notes = ?, bid_locked = ?,
            updated_at = datetime('now', 'localtime')
          WHERE id = ?`
        )
        .run(
          job.name, job.jobNumber, job.client, job.location,
          job.bidDate, job.startDate, job.description, job.status,
          job.overheadPercent, job.profitPercent, job.bondPercent,
          job.taxPercent, job.escalationPercent ?? 0, job.notes, job.bidLocked ? 1 : 0, job.id
        );
    } else {
      return db
        .prepare(
          `INSERT INTO jobs (name, job_number, client, location, bid_date, start_date, description, status, overhead_percent, profit_percent, bond_percent, tax_percent, escalation_percent, notes, parent_job_id, change_order_number)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          job.name, job.jobNumber, job.client, job.location,
          job.bidDate, job.startDate, job.description,
          job.overheadPercent, job.profitPercent, job.bondPercent,
          job.taxPercent, job.escalationPercent ?? 0, job.notes,
          job.parentJobId || null, job.changeOrderNumber || null
        );
    }
  });

  // Next auto job number to suggest in the create form. Derived fresh from
  // the max existing match each call — see shared/jobNumbering.ts for why
  // there is no stored counter.
  safeHandle('db:jobs:next-number', () => {
    const s = db
      .prepare('SELECT job_number_auto, job_number_format, job_number_start FROM app_settings WHERE id = 1')
      .get() as any;
    if (!s || s.job_number_auto !== 1) return { enabled: false, suggestion: null };
    const numbers = (
      db.prepare('SELECT job_number FROM jobs WHERE job_number IS NOT NULL').all() as any[]
    ).map((r) => r.job_number as string);
    return {
      enabled: true,
      suggestion: nextJobNumber(s.job_number_format || 'YYYY-NNN', numbers, s.job_number_start || 1),
    };
  });

  // Duplicate job numbers warn in the UI, never fail: legacy data may already
  // hold dupes, and change orders share the parent's number by design (they
  // are excluded here so a parent's own COs don't flag it).
  safeHandle('db:jobs:number-in-use', (_event, jobNumber: string, excludeJobId?: number) => {
    const trimmed = String(jobNumber || '').trim();
    if (!trimmed) return { inUse: false };
    const row = db
      .prepare(
        `SELECT id, name FROM jobs
         WHERE TRIM(job_number) = ? COLLATE NOCASE
           AND parent_job_id IS NULL
           AND id != COALESCE(?, -1)
         LIMIT 1`
      )
      .get(trimmed, excludeJobId ?? null) as any;
    return row ? { inUse: true, jobId: row.id, jobName: row.name } : { inUse: false };
  });

  safeHandle('db:jobs:delete', (_event, id: number) => {
    // Change orders are child jobs that cascade away with the parent —
    // collect their ids first so their document folders get cleaned too.
    const childIds = (db.prepare('SELECT id FROM jobs WHERE parent_job_id = ?').all(id) as any[])
      .map((r) => r.id as number);
    const result = db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
    // job_documents rows cascade with the job; the copied files don't,
    // so clear the managed document folders too.
    removeJobFiles(id);
    for (const childId of childIds) removeJobFiles(childId);
    return result;
  });

  safeHandle('db:jobs:duplicate', (_event, id: number, newName?: string, newBidDate?: string, newJobNumber?: string | null) => {
    const duplicate = db.transaction(() => {
      const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as any;
      if (!job) return null;
      // undefined = caller didn't offer a number field (keep the source's);
      // '' / null = deliberately cleared.
      const jobNumber = newJobNumber === undefined ? job.job_number : newJobNumber || null;

      const newJob = db
        .prepare(
          `INSERT INTO jobs (name, job_number, client, location, bid_date, start_date, description, status, overhead_percent, profit_percent, bond_percent, tax_percent, escalation_percent, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`
        )
        .run(
          newName || job.name + ' (Copy)', jobNumber, job.client, job.location,
          newBidDate ?? job.bid_date, job.start_date, job.description,
          job.overhead_percent, job.profit_percent, job.bond_percent,
          job.tax_percent, job.escalation_percent ?? 0, job.notes
        );
      const newJobId = Number(newJob.lastInsertRowid);

      // Copy bid sections and line items
      const sections = db.prepare('SELECT * FROM bid_sections WHERE job_id = ? ORDER BY sort_order').all(id) as any[];
      for (const section of sections) {
        const newSection = db
          .prepare(
            `INSERT INTO bid_sections
              (job_id, name, sort_order, is_alternate,
               overhead_percent_override, profit_percent_override, bond_percent_override)
            VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(newJobId, section.name, section.sort_order, section.is_alternate ?? 0,
            section.overhead_percent_override ?? null, section.profit_percent_override ?? null,
            section.bond_percent_override ?? null);
        const newSectionId = Number(newSection.lastInsertRowid);

        const items = db.prepare('SELECT * FROM bid_line_items WHERE section_id = ? ORDER BY sort_order').all(section.id) as any[];
        const insertItem = db.prepare(
          `INSERT INTO bid_line_items (
            section_id, job_id, description, quantity, unit, sort_order,
            material_id, material_unit_cost, material_total,
            crew_template_id, production_rate_id, labor_hours, labor_cost_per_hour, labor_total,
            equipment_id, equipment_cost_per_hour, equipment_hours, equipment_total,
            subcontractor_cost, unit_cost, total_cost, notes, item_number, cost_code
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const item of items) {
          insertItem.run(
            newSectionId, newJobId, item.description, item.quantity, item.unit, item.sort_order,
            item.material_id, item.material_unit_cost, item.material_total,
            item.crew_template_id, item.production_rate_id, item.labor_hours, item.labor_cost_per_hour, item.labor_total,
            item.equipment_id || null, item.equipment_cost_per_hour, item.equipment_hours, item.equipment_total,
            item.subcontractor_cost, item.unit_cost, item.total_cost, item.notes,
            item.item_number ?? null, item.cost_code ?? null
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
          pipe_material_id, bedding_material_id, backfill_material_id, bedding_depth_ft,
          compaction_pct
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const p of profiles) {
        insertProfile.run(
          newJobId, p.label, p.pipe_size_in, p.pipe_material, p.start_depth_ft,
          p.grade_pct, p.run_length_lf, p.trench_width_ft, p.bench_width_ft,
          p.bedding_type, p.backfill_type, p.sort_order,
          p.pipe_material_id, p.bedding_material_id, p.backfill_material_id, p.bedding_depth_ft,
          p.compaction_pct ?? 0
        );
      }

      // Copy indirect costs
      const indirects = db.prepare('SELECT * FROM job_indirect_costs WHERE job_id = ? ORDER BY sort_order').all(id) as any[];
      const insertIndirect = db.prepare(
        'INSERT INTO job_indirect_costs (job_id, description, amount, sort_order) VALUES (?, ?, ?, ?)'
      );
      for (const ic of indirects) {
        insertIndirect.run(newJobId, ic.description, ic.amount, ic.sort_order);
      }

      // Copy takeoff page scales
      const scales = db.prepare('SELECT * FROM takeoff_page_scales WHERE job_id = ?').all(id) as any[];
      const insertScale = db.prepare(
        `INSERT INTO takeoff_page_scales (job_id, page_number, scale_px_per_ft, scale_point1_x, scale_point1_y, scale_point2_x, scale_point2_y, scale_distance_ft)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const s of scales) {
        insertScale.run(newJobId, s.page_number, s.scale_px_per_ft, s.scale_point1_x, s.scale_point1_y, s.scale_point2_x, s.scale_point2_y, s.scale_distance_ft);
      }

      // Copy takeoff nodes (before runs, since points reference nodes)
      const oldNodes = db.prepare('SELECT * FROM takeoff_nodes WHERE job_id = ?').all(id) as any[];
      const insertNode = db.prepare(
        `INSERT INTO takeoff_nodes (job_id, x_px, y_px, pdf_page, invert_elev, rim_elev, structure_type, label)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const nodeIdMap = new Map<number, number>();
      for (const n of oldNodes) {
        const result = insertNode.run(newJobId, n.x_px, n.y_px, n.pdf_page, n.invert_elev, n.rim_elev, n.structure_type, n.label);
        nodeIdMap.set(n.id, Number(result.lastInsertRowid));
      }

      // Copy takeoff runs and their points
      const runs = db.prepare('SELECT * FROM takeoff_runs WHERE job_id = ? ORDER BY sort_order').all(id) as any[];
      const insertRun = db.prepare(
        `INSERT INTO takeoff_runs (job_id, label, utility_type, pipe_size_in, pipe_material, pipe_material_id, start_depth_ft, grade_pct, trench_width_ft, bench_width_ft, bedding_type, bedding_depth_ft, bedding_material_id, backfill_type, backfill_material_id, color, sort_order, pdf_page)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertPt = db.prepare(
        'INSERT INTO takeoff_points (run_id, x_px, y_px, sort_order, invert_elev, rim_elev, structure_type, node_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const r of runs) {
        const newRun = insertRun.run(
          newJobId, r.label, r.utility_type, r.pipe_size_in, r.pipe_material, r.pipe_material_id,
          r.start_depth_ft, r.grade_pct, r.trench_width_ft, r.bench_width_ft, r.bedding_type,
          r.bedding_depth_ft, r.bedding_material_id, r.backfill_type, r.backfill_material_id,
          r.color, r.sort_order, r.pdf_page
        );
        const newRunId = Number(newRun.lastInsertRowid);
        const points = db.prepare('SELECT * FROM takeoff_points WHERE run_id = ? ORDER BY sort_order').all(r.id) as any[];
        for (const pt of points) {
          const newNodeId = pt.node_id ? (nodeIdMap.get(pt.node_id) ?? null) : null;
          insertPt.run(newRunId, pt.x_px, pt.y_px, pt.sort_order, pt.invert_elev, pt.rim_elev, pt.structure_type, newNodeId);
        }
      }

      // Copy takeoff items
      const takeoffItems = db.prepare('SELECT * FROM takeoff_items WHERE job_id = ?').all(id) as any[];
      const insertTakeoffItem = db.prepare(
        `INSERT INTO takeoff_items (job_id, material_id, x_px, y_px, quantity, label, pdf_page, near_run_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const ti of takeoffItems) {
        insertTakeoffItem.run(newJobId, ti.material_id, ti.x_px, ti.y_px, ti.quantity, ti.label, ti.pdf_page, null);
      }

      // Copy quotes (vendor pricing gathered for this job)
      const jobQuotes = db.prepare('SELECT * FROM quotes WHERE job_id = ?').all(id) as any[];
      const insertQuote = db.prepare(
        `INSERT INTO quotes (job_id, scope, vendor, contact, amount, quote_date, notes, is_selected)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const q of jobQuotes) {
        insertQuote.run(newJobId, q.scope, q.vendor, q.contact, q.amount, q.quote_date, q.notes, q.is_selected);
      }

      // Copy takeoff areas and their points
      const takeoffAreas = db.prepare('SELECT * FROM takeoff_areas WHERE job_id = ? ORDER BY sort_order').all(id) as any[];
      const insertTakeoffArea = db.prepare(
        `INSERT INTO takeoff_areas (job_id, label, area_type, depth_ft, material_id, assembly_id, color, sort_order, pdf_page)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertAreaPt = db.prepare(
        'INSERT INTO takeoff_area_points (area_id, x_px, y_px, sort_order) VALUES (?, ?, ?, ?)'
      );
      for (const ta of takeoffAreas) {
        const newAreaId = Number(insertTakeoffArea.run(
          newJobId, ta.label, ta.area_type, ta.depth_ft, ta.material_id, ta.assembly_id, ta.color, ta.sort_order, ta.pdf_page
        ).lastInsertRowid);
        const areaPoints = db.prepare('SELECT * FROM takeoff_area_points WHERE area_id = ? ORDER BY sort_order').all(ta.id) as any[];
        for (const pt of areaPoints) {
          insertAreaPt.run(newAreaId, pt.x_px, pt.y_px, pt.sort_order);
        }
      }

      // Copy takeoff annotations
      const annotations = db.prepare('SELECT * FROM takeoff_annotations WHERE job_id = ?').all(id) as any[];
      const insertAnnotation = db.prepare(
        `INSERT INTO takeoff_annotations (job_id, pdf_page, kind, x1_px, y1_px, x2_px, y2_px, text, color)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const ann of annotations) {
        insertAnnotation.run(newJobId, ann.pdf_page, ann.kind, ann.x1_px, ann.y1_px,
          ann.x2_px, ann.y2_px, ann.text, ann.color);
      }

      // Copy takeoff page rotations
      const rotations = db.prepare('SELECT * FROM takeoff_page_rotations WHERE job_id = ?').all(id) as any[];
      const insertRotation = db.prepare(
        'INSERT INTO takeoff_page_rotations (job_id, page_number, rotation) VALUES (?, ?, ?)'
      );
      for (const r of rotations) {
        insertRotation.run(newJobId, r.page_number, r.rotation);
      }

      // Copy takeoff job settings (PDF path, legacy scale)
      const takeoffSettings = db.prepare('SELECT * FROM takeoff_job_settings WHERE job_id = ?').get(id) as any;
      if (takeoffSettings) {
        db.prepare(
          `INSERT INTO takeoff_job_settings (job_id, pdf_path, scale_px_per_ft, scale_point1_x, scale_point1_y, scale_point2_x, scale_point2_y, scale_distance_ft)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(newJobId, takeoffSettings.pdf_path, takeoffSettings.scale_px_per_ft, takeoffSettings.scale_point1_x, takeoffSettings.scale_point1_y, takeoffSettings.scale_point2_x, takeoffSettings.scale_point2_y, takeoffSettings.scale_distance_ft);
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

  // ================================================================
  // INDIRECT COSTS (job-level pool: mobilization, traffic control, …)
  // ================================================================

  safeHandle('db:indirects:list', (_event, jobId: number) => {
    return db.prepare(
      'SELECT * FROM job_indirect_costs WHERE job_id = ? ORDER BY sort_order, id'
    ).all(jobId);
  });

  safeHandle('db:indirects:save', (_event, indirect: any) => {
    const amount = Number(indirect.amount) || 0;
    if (indirect.id) {
      db.prepare(
        'UPDATE job_indirect_costs SET description = ?, amount = ?, sort_order = ? WHERE id = ?'
      ).run(indirect.description ?? '', amount, indirect.sortOrder ?? 0, indirect.id);
      return { id: indirect.id };
    }
    const result = db.prepare(
      'INSERT INTO job_indirect_costs (job_id, description, amount, sort_order) VALUES (?, ?, ?, ?)'
    ).run(indirect.jobId, indirect.description ?? '', amount, indirect.sortOrder ?? 0);
    return { id: Number(result.lastInsertRowid) };
  });

  safeHandle('db:indirects:delete', (_event, id: number) => {
    return db.prepare('DELETE FROM job_indirect_costs WHERE id = ?').run(id);
  });

  safeHandle('db:jobs:summary', (_event, jobId: number) => {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as any;
    if (!job) return null;

    const summary = computeBidSummaryFromSections(getSectionCostRows(db, jobId), job, getIndirectTotal(db, jobId));

    return {
      jobId,
      ...summary,
    };
  });

  safeHandle('db:jobs:summary-batch', (_event, jobIds: number[]) => {
    if (!jobIds.length) return [];
    const placeholders = jobIds.map(() => '?').join(',');

    const jobs = db.prepare(`SELECT * FROM jobs WHERE id IN (${placeholders})`).all(...jobIds) as any[];
    const jobMap = new Map(jobs.map((j: any) => [j.id, j]));

    return jobIds.map((id) => {
      const job = jobMap.get(id);
      if (!job) return null;

      const summary = computeBidSummaryFromSections(getSectionCostRows(db, id), job, getIndirectTotal(db, id));

      return {
        jobId: id,
        ...summary,
      };
    }).filter(Boolean);
  });

}
