import { dialog, app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { getDbPath, isSetupComplete, seedDatabase } from '../database';
import { logger } from '../logger';
import { TradeType } from '../../shared/constants/seed-data';
import { computeBidSummaryFromSections } from '../../shared/bidCalc';
import { safeHandle, getSectionCostRows } from './shared';

export function registerTakeoffHandlers(db: Database.Database): void {
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
  // PLAN TAKEOFF
  // ================================================================

  safeHandle('db:takeoff:open-pdf', async () => {
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
    const resolved = path.resolve(filePath);
    const ext = path.extname(resolved).toLowerCase();
    if (ext !== '.pdf') {
      logger.warn('takeoff:read-pdf', `Rejected non-PDF file: ${resolved}`);
      return null;
    }
    if (!fs.existsSync(resolved)) {
      logger.warn('takeoff:read-pdf', `File not found: ${resolved}`);
      return null;
    }
    try {
      const data = fs.readFileSync(resolved);
      return { data };
    } catch (err: any) {
      logger.error('takeoff:read-pdf', `Failed to read ${resolved}`, err.message);
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

  safeHandle('db:takeoff-page-rotation:get', (_event, jobId: number, pageNumber: number) => {
    const row = db.prepare(
      'SELECT rotation FROM takeoff_page_rotations WHERE job_id = ? AND page_number = ?'
    ).get(jobId, pageNumber) as any;
    return row?.rotation ?? 0;
  });

  safeHandle('db:takeoff-page-rotation:save', (_event, jobId: number, pageNumber: number, rotation: number) => {
    return db.prepare(`
      INSERT INTO takeoff_page_rotations (job_id, page_number, rotation)
      VALUES (?, ?, ?)
      ON CONFLICT(job_id, page_number) DO UPDATE SET rotation = excluded.rotation
    `).run(jobId, pageNumber, ((rotation % 360) + 360) % 360);
  });

  safeHandle('db:takeoff-page-scale:list', (_event, jobId: number) => {
    return db.prepare(
      'SELECT page_number, scale_px_per_ft FROM takeoff_page_scales WHERE job_id = ?'
    ).all(jobId) as any[];
  });

  // ---- Takeoff Runs ----

  safeHandle('db:takeoff-runs:list', (_event, jobId: number) => {
    const runs = db.prepare('SELECT * FROM takeoff_runs WHERE job_id = ? ORDER BY sort_order').all(jobId) as any[];
    const pointsStmt = db.prepare(`
      SELECT tp.x_px, tp.y_px, tp.invert_elev, tp.rim_elev, tp.structure_type, tp.node_id,
             tn.x_px AS node_x, tn.y_px AS node_y,
             tn.invert_elev AS node_invert, tn.rim_elev AS node_rim,
             tn.structure_type AS node_structure
      FROM takeoff_points tp
      LEFT JOIN takeoff_nodes tn ON tp.node_id = tn.id
      WHERE tp.run_id = ? ORDER BY tp.sort_order
    `);
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
      points: (pointsStmt.all(r.id) as any[]).map((p) => ({
        x: p.node_id ? p.node_x : p.x_px,
        y: p.node_id ? p.node_y : p.y_px,
        invertElev: p.node_id ? p.node_invert : p.invert_elev,
        rimElev: p.node_id ? p.node_rim : p.rim_elev,
        structureType: p.node_id ? p.node_structure : p.structure_type,
        nodeId: p.node_id,
      })),
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
      const insertPt = db.prepare('INSERT INTO takeoff_points (run_id, x_px, y_px, sort_order, invert_elev, rim_elev, structure_type, node_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      if (run.points) {
        for (let i = 0; i < run.points.length; i++) {
          const pt = run.points[i];
          insertPt.run(runId, pt.x, pt.y, i, pt.invertElev ?? null, pt.rimElev ?? null, pt.structureType ?? null, pt.nodeId ?? null);
        }
      }

      return { id: runId };
    });
    return saveTx();
  });

  safeHandle('db:takeoff-runs:delete', (_event, id: number) => {
    return db.prepare('DELETE FROM takeoff_runs WHERE id = ?').run(id);
  });

  safeHandle('db:takeoff-points:update', (_event, data: { runId: number; sortOrder: number; invertElev: number | null; rimElev: number | null; structureType: string | null; nodeId?: number | null }) => {
    return db.prepare(
      'UPDATE takeoff_points SET invert_elev = ?, rim_elev = ?, structure_type = ?, node_id = ? WHERE run_id = ? AND sort_order = ?'
    ).run(data.invertElev, data.rimElev, data.structureType, data.nodeId ?? null, data.runId, data.sortOrder);
  });

  // ---- Takeoff Nodes (shared junction points: manholes, cleanouts, tees) ----

  safeHandle('db:takeoff-nodes:list', (_event, jobId: number) => {
    const rows = db.prepare('SELECT * FROM takeoff_nodes WHERE job_id = ? ORDER BY id').all(jobId) as any[];
    return rows.map((n) => ({
      id: n.id,
      jobId: n.job_id,
      xPx: n.x_px,
      yPx: n.y_px,
      pdfPage: n.pdf_page,
      invertElev: n.invert_elev,
      rimElev: n.rim_elev,
      structureType: n.structure_type,
      label: n.label,
    }));
  });

  safeHandle('db:takeoff-nodes:save', (_event, node: any) => {
    if (node.id && node.id > 0) {
      db.prepare(`
        UPDATE takeoff_nodes SET
          x_px = ?, y_px = ?, pdf_page = ?, invert_elev = ?,
          rim_elev = ?, structure_type = ?, label = ?
        WHERE id = ?
      `).run(
        node.xPx, node.yPx, node.pdfPage, node.invertElev ?? null,
        node.rimElev ?? null, node.structureType ?? null, node.label ?? '',
        node.id
      );
      return { id: node.id };
    } else {
      const result = db.prepare(`
        INSERT INTO takeoff_nodes
          (job_id, x_px, y_px, pdf_page, invert_elev, rim_elev, structure_type, label)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        node.jobId, node.xPx, node.yPx, node.pdfPage,
        node.invertElev ?? null, node.rimElev ?? null,
        node.structureType ?? null, node.label ?? ''
      );
      return { id: Number(result.lastInsertRowid) };
    }
  });

  safeHandle('db:takeoff-nodes:delete', (_event, id: number) => {
    return db.prepare('DELETE FROM takeoff_nodes WHERE id = ?').run(id);
  });

  safeHandle('db:takeoff-nodes:connected-runs', (_event, nodeId: number) => {
    const rows = db.prepare(
      'SELECT DISTINCT run_id FROM takeoff_points WHERE node_id = ?'
    ).all(nodeId) as any[];
    return rows.map((r) => r.run_id as number);
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

  // ---- Takeoff Areas (surface restoration polygons: asphalt, concrete, gravel) ----

  safeHandle('db:takeoff-areas:list', (_event, jobId: number) => {
    const areas = db.prepare('SELECT * FROM takeoff_areas WHERE job_id = ? ORDER BY sort_order').all(jobId) as any[];
    const pointsStmt = db.prepare(
      'SELECT x_px, y_px FROM takeoff_area_points WHERE area_id = ? ORDER BY sort_order'
    );
    return areas.map((a) => ({
      id: a.id,
      jobId: a.job_id,
      label: a.label,
      areaType: a.area_type,
      depthFt: a.depth_ft,
      materialId: a.material_id,
      assemblyId: a.assembly_id,
      color: a.color,
      pdfPage: a.pdf_page,
      points: (pointsStmt.all(a.id) as any[]).map((p) => ({ x: p.x_px, y: p.y_px })),
    }));
  });

  safeHandle('db:takeoff-areas:save', (_event, area: any) => {
    const saveTx = db.transaction(() => {
      let areaId: number;
      if (area.id && area.id > 0) {
        db.prepare(`
          UPDATE takeoff_areas SET
            label = ?, area_type = ?, depth_ft = ?, material_id = ?, assembly_id = ?,
            color = ?, sort_order = ?, pdf_page = ?,
            updated_at = datetime('now','localtime')
          WHERE id = ?
        `).run(
          area.label, area.areaType, area.depthFt, area.materialId ?? null, area.assemblyId ?? null,
          area.color, area.sortOrder ?? 0, area.pdfPage, area.id
        );
        areaId = area.id;
      } else {
        const result = db.prepare(`
          INSERT INTO takeoff_areas
            (job_id, label, area_type, depth_ft, material_id, assembly_id, color, sort_order, pdf_page)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          area.jobId, area.label, area.areaType, area.depthFt,
          area.materialId ?? null, area.assemblyId ?? null, area.color, area.sortOrder ?? 0, area.pdfPage
        );
        areaId = Number(result.lastInsertRowid);
      }

      // Replace points
      db.prepare('DELETE FROM takeoff_area_points WHERE area_id = ?').run(areaId);
      const insertPt = db.prepare('INSERT INTO takeoff_area_points (area_id, x_px, y_px, sort_order) VALUES (?, ?, ?, ?)');
      if (area.points) {
        for (let i = 0; i < area.points.length; i++) {
          insertPt.run(areaId, area.points[i].x, area.points[i].y, i);
        }
      }

      return { id: areaId };
    });
    return saveTx();
  });

  safeHandle('db:takeoff-areas:delete', (_event, id: number) => {
    return db.prepare('DELETE FROM takeoff_areas WHERE id = ?').run(id);
  });

  // ---- Takeoff Annotations (text notes, arrows, revision clouds) ----

  safeHandle('db:takeoff-annotations:list', (_event, jobId: number) => {
    const rows = db.prepare(
      'SELECT * FROM takeoff_annotations WHERE job_id = ? ORDER BY id'
    ).all(jobId) as any[];
    return rows.map((a) => ({
      id: a.id,
      jobId: a.job_id,
      pdfPage: a.pdf_page,
      kind: a.kind,
      x1: a.x1_px,
      y1: a.y1_px,
      x2: a.x2_px,
      y2: a.y2_px,
      text: a.text,
      color: a.color,
    }));
  });

  safeHandle('db:takeoff-annotations:save', (_event, ann: any) => {
    if (ann.id && ann.id > 0) {
      db.prepare(
        `UPDATE takeoff_annotations SET pdf_page = ?, kind = ?, x1_px = ?, y1_px = ?,
          x2_px = ?, y2_px = ?, text = ?, color = ? WHERE id = ?`
      ).run(ann.pdfPage, ann.kind, ann.x1, ann.y1, ann.x2 ?? null, ann.y2 ?? null,
        ann.text ?? '', ann.color, ann.id);
      return { id: ann.id };
    } else {
      const result = db.prepare(
        `INSERT INTO takeoff_annotations (job_id, pdf_page, kind, x1_px, y1_px, x2_px, y2_px, text, color)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(ann.jobId, ann.pdfPage, ann.kind, ann.x1, ann.y1, ann.x2 ?? null, ann.y2 ?? null,
        ann.text ?? '', ann.color);
      return { id: Number(result.lastInsertRowid) };
    }
  });

  safeHandle('db:takeoff-annotations:delete', (_event, id: number) => {
    return db.prepare('DELETE FROM takeoff_annotations WHERE id = ?').run(id);
  });

  // ---- Takeoff undo/redo state restore ----

  // CRITICAL — do not refactor; preserves entity IDs for history + cloud sync.
  // Replaces the entire takeoff state (runs, points, nodes, items, areas)
  // for a job in one transaction, preserving entity IDs so history snapshots
  // stay valid across undo/redo cycles. Negative (never-saved) IDs are skipped.
  safeHandle('db:takeoff:replace-state', (_event, jobId: number, state: any) => {
    const replaceTx = db.transaction(() => {
      db.prepare('DELETE FROM takeoff_items WHERE job_id = ?').run(jobId);
      db.prepare('DELETE FROM takeoff_areas WHERE job_id = ?').run(jobId);
      db.prepare('DELETE FROM takeoff_runs WHERE job_id = ?').run(jobId);
      db.prepare('DELETE FROM takeoff_nodes WHERE job_id = ?').run(jobId);
      db.prepare('DELETE FROM takeoff_annotations WHERE job_id = ?').run(jobId);

      // Nodes first — run points reference them
      const insertNode = db.prepare(
        `INSERT INTO takeoff_nodes (id, job_id, x_px, y_px, pdf_page, invert_elev, rim_elev, structure_type, label)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const n of state.nodes || []) {
        if (n.id <= 0) continue;
        insertNode.run(n.id, jobId, n.xPx, n.yPx, n.pdfPage,
          n.invertElev ?? null, n.rimElev ?? null, n.structureType ?? null, n.label ?? '');
      }

      const insertRun = db.prepare(
        `INSERT INTO takeoff_runs
          (id, job_id, label, utility_type, pipe_size_in, pipe_material, pipe_material_id,
           start_depth_ft, grade_pct, trench_width_ft, bench_width_ft, bedding_type,
           bedding_depth_ft, bedding_material_id, backfill_type, backfill_material_id,
           color, sort_order, pdf_page)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertPt = db.prepare(
        'INSERT INTO takeoff_points (run_id, x_px, y_px, sort_order, invert_elev, rim_elev, structure_type, node_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      );
      (state.runs || []).forEach((r: any, idx: number) => {
        if (r.id <= 0) return;
        insertRun.run(r.id, jobId, r.label, r.utilityType, r.pipeSizeIn, r.pipeMaterial,
          r.pipeMaterialId ?? null, r.startDepthFt, r.gradePct, r.trenchWidthFt,
          r.benchWidthFt, r.beddingType, r.beddingDepthFt, r.beddingMaterialId ?? null,
          r.backfillType, r.backfillMaterialId ?? null, r.color, idx, r.pdfPage);
        (r.points || []).forEach((pt: any, i: number) => {
          insertPt.run(r.id, pt.x, pt.y, i, pt.invertElev ?? null, pt.rimElev ?? null,
            pt.structureType ?? null, pt.nodeId ?? null);
        });
      });

      const insertItem = db.prepare(
        `INSERT INTO takeoff_items (id, job_id, material_id, x_px, y_px, quantity, label, pdf_page, near_run_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const i of state.items || []) {
        if (i.id <= 0) continue;
        // A referenced run may have been a negative-ID (skipped) entity
        const nearRunId = i.nearRunId && i.nearRunId > 0 ? i.nearRunId : null;
        insertItem.run(i.id, jobId, i.materialId ?? null, i.xPx, i.yPx,
          i.quantity ?? 1, i.label ?? '', i.pdfPage, nearRunId);
      }

      const insertArea = db.prepare(
        `INSERT INTO takeoff_areas (id, job_id, label, area_type, depth_ft, material_id, assembly_id, color, sort_order, pdf_page)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertAreaPt = db.prepare(
        'INSERT INTO takeoff_area_points (area_id, x_px, y_px, sort_order) VALUES (?, ?, ?, ?)'
      );
      (state.areas || []).forEach((a: any, idx: number) => {
        if (a.id <= 0) return;
        insertArea.run(a.id, jobId, a.label, a.areaType, a.depthFt,
          a.materialId ?? null, a.assemblyId ?? null, a.color, idx, a.pdfPage);
        (a.points || []).forEach((pt: any, i: number) => {
          insertAreaPt.run(a.id, pt.x, pt.y, i);
        });
      });

      const insertAnn = db.prepare(
        `INSERT INTO takeoff_annotations (id, job_id, pdf_page, kind, x1_px, y1_px, x2_px, y2_px, text, color)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const ann of state.annotations || []) {
        if (ann.id <= 0) continue;
        insertAnn.run(ann.id, jobId, ann.pdfPage, ann.kind, ann.x1, ann.y1,
          ann.x2 ?? null, ann.y2 ?? null, ann.text ?? '', ann.color);
      }

      return { success: true };
    });
    return replaceTx();
  });

  // ---- Takeoff CSV export ----

  safeHandle('takeoff:export-csv', async (_event, jobId: number, csvContent: string) => {
    const job = db.prepare('SELECT name, job_number FROM jobs WHERE id = ?').get(jobId) as any;
    const safeName = (job?.job_number || job?.name || 'takeoff').replace(/[^a-zA-Z0-9_-]/g, '_');
    const result = await dialog.showSaveDialog({
      title: 'Export Takeoff Quantities to CSV',
      defaultPath: `${safeName}-takeoff.csv`,
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    fs.writeFileSync(result.filePath, csvContent, 'utf-8');
    logger.info('takeoff:export-csv', `Exported takeoff for job ${jobId} to ${result.filePath}`);
    return { success: true, path: result.filePath };
  });

}
