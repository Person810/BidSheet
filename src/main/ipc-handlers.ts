import type Database from 'better-sqlite3';
import { registerSettingsHandlers } from './ipc/settings';
import { registerCatalogHandlers } from './ipc/catalog';
import { registerJobHandlers } from './ipc/jobs';
import { registerBidHandlers } from './ipc/bids';
import { registerQuoteHandlers } from './ipc/quotes';
import { registerTakeoffHandlers } from './ipc/takeoff';
import { registerExportHandlers } from './ipc/export';
import { registerPriceImportHandlers } from './ipc/price-import';

/**
 * Registers every `db:*` / `jobs:*` / `app:*` IPC handler with Electron.
 * Handlers are grouped by domain under ./ipc/*; this is just the wiring.
 */
export function registerIpcHandlers(db: Database.Database): void {
  registerSettingsHandlers(db);
  registerCatalogHandlers(db);
  registerJobHandlers(db);
  registerBidHandlers(db);
  registerQuoteHandlers(db);
  registerTakeoffHandlers(db);
  registerExportHandlers(db);
  registerPriceImportHandlers(db);
}
