import { dialog, app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import { getDbPath, isSetupComplete, seedDatabase } from '../database';
import { logger } from '../logger';
import { TradeType } from '../../shared/constants/seed-data';
import { computeBidSummaryFromSections } from '../../shared/bidCalc';
import { safeHandle, getSectionCostRows } from './shared';

export function registerQuoteHandlers(db: Database.Database): void {
  // ================================================================
  // SUBCONTRACTOR / SUPPLIER QUOTES
  // ================================================================

  safeHandle('db:quotes:list', (_event, jobId: number) => {
    return db.prepare(
      'SELECT * FROM quotes WHERE job_id = ? ORDER BY scope, amount, id'
    ).all(jobId);
  });

  safeHandle('db:quotes:save', (_event, quote: any) => {
    if (quote.id) {
      // Moving a quote to a different scope drops its winner flag — the new
      // scope may already have a winner
      const existing = db.prepare('SELECT scope FROM quotes WHERE id = ?').get(quote.id) as any;
      const scopeChanged = existing && existing.scope !== quote.scope;
      db.prepare(
        `UPDATE quotes SET scope = ?, vendor = ?, contact = ?, amount = ?,
          quote_date = ?, notes = ?,
          is_selected = CASE WHEN ? THEN 0 ELSE is_selected END
        WHERE id = ?`
      ).run(quote.scope, quote.vendor, quote.contact ?? '', quote.amount ?? 0,
        quote.quoteDate ?? null, quote.notes ?? null, scopeChanged ? 1 : 0, quote.id);
      return { id: quote.id };
    } else {
      const result = db.prepare(
        `INSERT INTO quotes (job_id, scope, vendor, contact, amount, quote_date, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(quote.jobId, quote.scope, quote.vendor, quote.contact ?? '',
        quote.amount ?? 0, quote.quoteDate ?? null, quote.notes ?? null);
      return { id: Number(result.lastInsertRowid) };
    }
  });

  // Pick the winning quote for a scope (one winner per scope; pass null id to clear)
  safeHandle('db:quotes:select', (_event, jobId: number, scope: string, quoteId: number | null) => {
    const selectTx = db.transaction(() => {
      db.prepare('UPDATE quotes SET is_selected = 0 WHERE job_id = ? AND scope = ?').run(jobId, scope);
      if (quoteId != null) {
        db.prepare('UPDATE quotes SET is_selected = 1 WHERE id = ? AND job_id = ? AND scope = ?')
          .run(quoteId, jobId, scope);
      }
      return { success: true };
    });
    return selectTx();
  });

  safeHandle('db:quotes:delete', (_event, id: number) => {
    return db.prepare('DELETE FROM quotes WHERE id = ?').run(id);
  });

}
