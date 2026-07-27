import { ipcMain } from 'electron';
import type Database from 'better-sqlite3';
import { logger } from '../logger';
import type { SectionCostRow } from '../../shared/bidCalc';

/**
 * Build a `LIKE '%…%'` pattern that treats user input as literal text.
 *
 * Without this, typing `%` matches every row and `_` matches any character —
 * search silently stops meaning what the user typed. Pair with `ESCAPE '\'`
 * in the SQL.
 */
export function likeContains(value: string): string {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Per-section cost roll-up feeding the section-aware bid summary.
 * Includes empty sections so alternates always appear in summaries.
 */
export function getSectionCostRows(db: Database.Database, jobId: number): SectionCostRow[] {
  return db.prepare(
    `SELECT
      s.id as section_id,
      s.name,
      s.is_alternate,
      s.overhead_percent_override,
      s.profit_percent_override,
      s.bond_percent_override,
      COALESCE(SUM(li.material_total), 0) as material_total,
      COALESCE(SUM(li.labor_total), 0) as labor_total,
      COALESCE(SUM(li.equipment_total), 0) as equipment_total,
      COALESCE(SUM(li.subcontractor_cost), 0) as subcontractor_total,
      COALESCE(SUM(li.total_cost), 0) as direct_cost_total
    FROM bid_sections s
    LEFT JOIN bid_line_items li ON li.section_id = s.id
    WHERE s.job_id = ?
    GROUP BY s.id
    ORDER BY s.sort_order`
  ).all(jobId) as SectionCostRow[];
}

/** Job-level indirect-cost pool total, feeding computeBidSummaryFromSections. */
export function getIndirectTotal(db: Database.Database, jobId: number): number {
  const row = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM job_indirect_costs WHERE job_id = ?'
  ).get(jobId) as any;
  return row.total;
}

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
  if (code === 'SQLITE_CONSTRAINT' || msg.includes('UNIQUE constraint') || msg.includes('FOREIGN KEY constraint')) {
    if (msg.includes('UNIQUE constraint')) {
      const match = msg.match(/UNIQUE constraint failed: (\w+)\.(\w+)/);
      if (match) {
        const field = match[2].replace(/_/g, ' ');
        return `A record with that ${field} already exists.`;
      }
      return 'A record with those values already exists. Check for duplicates.';
    }
    if (msg.includes('FOREIGN KEY constraint')) {
      return 'This record is referenced by other data and cannot be modified.';
    }
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
export function safeHandle(
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
