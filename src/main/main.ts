import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'path';
import { initializeDatabase } from './database';
import { registerIpcHandlers } from './ipc-handlers';
import { logger } from './logger';
import type Database from 'better-sqlite3';

let mainWindow: BrowserWindow | null = null;
let db: Database.Database | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ================================================================
// Process-level error handlers -- last line of defense
// ================================================================

process.on('uncaughtException', (err) => {
  logger.error('process', 'Uncaught exception', err.stack || err.message);
  // Show a dialog so the user knows something went wrong
  dialog.showErrorBox(
    'BidSheet - Unexpected Error',
    'Something went wrong. The error has been logged.\n\n' +
    'If this keeps happening, check the log files in:\n' +
    logger.getLogDir() + '\n\n' +
    err.message
  );
});

process.on('unhandledRejection', (reason: any) => {
  const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
  logger.error('process', 'Unhandled promise rejection', msg);
});

// ================================================================
// Window
// ================================================================

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'BidSheet',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ================================================================
// App lifecycle
// ================================================================

app.whenReady().then(() => {
  logger.info('app', `BidSheet v${app.getVersion()} starting`);
  logger.info('app', `Logs: ${logger.getLogDir()}`);

  // Initialize database
  try {
    db = initializeDatabase();
    logger.info('db', `Database opened: ${db.name}`);
  } catch (err: any) {
    logger.error('db', 'Failed to initialize database', err.stack || err.message);
    dialog.showErrorBox(
      'BidSheet - Database Error',
      'Could not open the database. The app will close.\n\n' +
      err.message + '\n\n' +
      'If this keeps happening, try restoring from a backup.'
    );
    app.quit();
    return;
  }

  // Register IPC handlers so renderer can talk to the database
  registerIpcHandlers(db);

  // Expose log directory path to renderer for the Settings page
  ipcMain.handle('app:log-dir', () => logger.getLogDir());

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (db) {
    try {
      db.close();
    } catch (err: any) {
      logger.warn('db', 'Error closing database', err.message);
    }
    db = null;
  }
  logger.info('app', 'BidSheet shutting down');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
