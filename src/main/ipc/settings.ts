import { dialog, app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import {
  getDbPath, isSetupComplete, seedDatabase, addTradeCatalog,
  seedCatalogStatus, removeSeedCatalog, restoreSeedCatalog,
} from '../database';
import { logger } from '../logger';
import { TradeType, TRADE_SEED_DATA } from '../../shared/constants/seed-data';
import { computeBidSummaryFromSections } from '../../shared/bidCalc';
import { safeHandle, getSectionCostRows } from './shared';
import { parsePdfTemplate, PdfTemplate } from '../../shared/types/pdf';
import { parseUnitSystem } from '../../shared/unitSystem';

export function registerSettingsHandlers(db: Database.Database): void {
  // ================================================================
  // SETUP
  // ================================================================

  safeHandle('db:setup:is-complete', () => {
    return isSetupComplete(db);
  });

  safeHandle(
    'db:setup:run',
    (_event, trades: string[], includeBallparkPrices: boolean, companyName: string, localOnlyMode?: boolean, includeSampleCatalog?: boolean) => {
      seedDatabase(
        db, trades as TradeType[], includeBallparkPrices, companyName,
        localOnlyMode === true, includeSampleCatalog !== false
      );
      logger.info('setup', `Setup complete: trades=${trades.join(',')}, company=${companyName}, localOnly=${localOnlyMode === true}, sampleCatalog=${includeSampleCatalog !== false}`);
      return { success: true };
    }
  );

  // ================================================================
  // SAMPLE CATALOG (seed items)
  // ================================================================

  safeHandle('db:seeds:status', () => {
    return seedCatalogStatus(db);
  });

  // Hide all sample items (soft delete; labor roles not used by a crew are
  // removed outright since they have no hidden state). Reversible via restore.
  safeHandle('db:seeds:remove', () => {
    const result = removeSeedCatalog(db);
    logger.info('settings', `Sample catalog hidden: ${result.hidden} items, ${result.deletedRoles} labor roles removed`);
    return result;
  });

  // Bring back sample items for the active trades: un-hides hidden ones
  // (keeping any edits) and re-creates missing ones with seed values.
  safeHandle('db:seeds:restore', (_event, includeBallparkPrices: boolean) => {
    const result = restoreSeedCatalog(db, includeBallparkPrices !== false);
    logger.info('settings', `Sample catalog restored: ${result.restored} un-hidden, ${result.readded} re-created`);
    return result;
  });

  // Add a trade to an existing setup: seeds its catalog additively and makes
  // its gated module/tools visible. Never deletes or overwrites edited rows.
  safeHandle(
    'db:settings:add-trade',
    (_event, trade: string, includeBallparkPrices: boolean) => {
      if (!(trade in TRADE_SEED_DATA)) {
        throw new Error(`Unknown trade: ${trade}`);
      }
      const tradeTypes = addTradeCatalog(db, trade as TradeType, includeBallparkPrices !== false);
      logger.info('settings', `Added trade "${trade}" (prices=${includeBallparkPrices !== false}); trades now: ${tradeTypes}`);
      return { success: true, tradeTypes };
    }
  );

  // ================================================================
  // DATABASE BACKUP / RESTORE
  // These keep their existing { success, error } return shape
  // because the renderer UI already reads it. Logging is added.
  // ================================================================

  safeHandle('db:export', async () => {
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

  safeHandle('db:restore', async () => {
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
        logger.error('db:restore', 'File size mismatch after copy. Original restored. Relaunching.');
        // DB connection is closed — must relaunch to recover
        app.relaunch();
        app.exit(0);
        return { success: false, error: 'Restore failed: file size mismatch. Original database has been preserved. The app will restart.' };
      }

      try { fs.unlinkSync(safetyPath); } catch (_) {}

      logger.info('db:restore', `Database restored from ${backupPath}. Relaunching.`);

      app.relaunch();
      app.exit(0);

      return { success: true };
    } catch (err: any) {
      // DB connection is closed — restore the safety backup and relaunch
      logger.error('db:restore', 'Restore failed, relaunching with original DB', err.stack || err.message);
      try {
        const dbPath = getDbPath();
        const safetyPath = dbPath + '.pre-restore';
        if (fs.existsSync(safetyPath)) {
          fs.copyFileSync(safetyPath, dbPath);
          try { fs.unlinkSync(safetyPath); } catch (_) {}
        }
      } catch (_) {}
      app.relaunch();
      app.exit(0);
      return { success: false, error: err.message };
    }
  });

  // ================================================================
  // SETTINGS
  // ================================================================

  safeHandle('db:settings:get', () => {
    return db.prepare('SELECT * FROM app_settings WHERE id = 1').get();
  });

  safeHandle('app:log-dir', () => {
    return logger.getLogDir();
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

  safeHandle('db:settings:choose-logo', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Choose Company Logo',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const filePath = result.filePaths[0];
    // Stored inline as a data URL (survives moved/deleted source files);
    // cap the size so the settings row and proposal PDFs stay reasonable
    const stat = fs.statSync(filePath);
    if (stat.size > 2 * 1024 * 1024) {
      throw new Error('Logo image must be under 2 MB.');
    }
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    const data = fs.readFileSync(filePath).toString('base64');
    return { dataUrl: `data:image/${mime};base64,${data}` };
  });

  safeHandle('db:settings:save', (_event, settings: any) => {
    return db
      .prepare(
        `UPDATE app_settings SET
          company_name = ?, company_address = ?, company_phone = ?,
          company_email = ?, company_tagline = ?, company_logo = ?,
          default_overhead_percent = ?, default_profit_percent = ?,
          default_tax_percent = ?, default_bond_percent = ?,
          auto_lock_on_close = ?, local_only_mode = ?,
          job_number_auto = ?, job_number_format = ?, job_number_start = ?,
          unit_system = ?
        WHERE id = 1`
      )
      .run(
        settings.companyName, settings.companyAddress, settings.companyPhone,
        settings.companyEmail, settings.companyTagline, settings.companyLogo,
        settings.defaultOverheadPercent, settings.defaultProfitPercent,
        settings.defaultTaxPercent, settings.defaultBondPercent,
        settings.autoLockOnClose ? 1 : 0,
        settings.localOnlyMode ? 1 : 0,
        settings.jobNumberAuto ? 1 : 0,
        settings.jobNumberFormat || 'YYYY-NNN',
        Math.max(1, Math.floor(Number(settings.jobNumberStart)) || 1),
        parseUnitSystem(settings.unitSystem)
      );
  });

  safeHandle('settings:get-pdf-template', () => {
    const row = db.prepare('SELECT pdf_template_json FROM app_settings WHERE id = 1').get() as any;
    return parsePdfTemplate(row?.pdf_template_json);
  });

  safeHandle('settings:save-pdf-template', (_event, template: PdfTemplate) => {
    db.prepare('UPDATE app_settings SET pdf_template_json = ? WHERE id = 1').run(JSON.stringify(template));
  });

}
