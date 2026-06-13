import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import path from 'path';
import { initializeDatabase } from './database';
import { registerIpcHandlers } from './ipc-handlers';
import { registerCloudHandlers, registerLocalOnlyCloudStub } from './cloud/ipc';
import { initAutoUpdater } from './updater';
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

Menu.setApplicationMenu(null);

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'BidSheet',
    // Bundled at the app root via build.files ("assets/**/*"); __dirname is
    // dist/main both in dev and inside the asar, so assets sits two levels up.
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The renderer parses untrusted PDFs (plan rooms, GC emails) — treat it
  // like a browser tab. The app is a single local page: any navigation away
  // from it is a bug or an exploit attempt, and new windows only ever mean
  // external links, which belong in the system browser.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedDev = isDev && url.startsWith('http://localhost:5173');
    if (!allowedDev && !url.startsWith('file://')) {
      logger.warn('security', `Blocked navigation to ${url}`);
      event.preventDefault();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      shell.openExternal(url);
    } else {
      logger.warn('security', `Blocked window.open to ${url}`);
    }
    return { action: 'deny' };
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

  // Local-only mode skips cloud init entirely — no Supabase client, no
  // Worker requests. Read at startup; toggling it in Settings takes effect
  // on the next launch.
  const localOnly = (db.prepare('SELECT local_only_mode FROM app_settings WHERE id = 1').get() as any)
    ?.local_only_mode === 1;
  if (localOnly) {
    registerLocalOnlyCloudStub();
  } else {
    registerCloudHandlers(db);
  }

  createWindow();

  // Start auto-updater (checks GitHub Releases for new versions)
  if (mainWindow) {
    initAutoUpdater(mainWindow);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (db) {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
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
