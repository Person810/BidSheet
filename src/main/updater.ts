import { autoUpdater, UpdateInfo } from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';
import { logger } from './logger';

/**
 * Initializes the auto-updater that checks GitHub Releases for new versions.
 * Uses electron-updater which reads the `publish` config from package.json
 * and compares the current app version against the latest GitHub Release tag.
 */
export function initAutoUpdater(mainWindow: BrowserWindow): void {
  // Don't run updater in dev mode
  if (!require('electron').app.isPackaged) {
    logger.info('updater', 'Skipping auto-updater in dev mode');
    return;
  }

  // Configure updater
  autoUpdater.autoDownload = false; // Let the user decide
  autoUpdater.autoInstallOnAppQuit = true;

  // ---- Events → renderer ----

  autoUpdater.on('checking-for-update', () => {
    logger.info('updater', 'Checking for updates...');
    sendToRenderer(mainWindow, 'update-status', { status: 'checking' });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    logger.info('updater', `Update available: v${info.version}`);
    sendToRenderer(mainWindow, 'update-status', {
      status: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : undefined,
    });
  });

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    logger.info('updater', `Already on latest: v${info.version}`);
    sendToRenderer(mainWindow, 'update-status', {
      status: 'up-to-date',
      version: info.version,
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    logger.info('updater', `Download progress: ${Math.round(progress.percent)}%`);
    sendToRenderer(mainWindow, 'update-status', {
      status: 'downloading',
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    logger.info('updater', `Update downloaded: v${info.version}`);
    sendToRenderer(mainWindow, 'update-status', {
      status: 'downloaded',
      version: info.version,
    });
  });

  autoUpdater.on('error', (err) => {
    logger.error('updater', 'Update error', err.message);
    sendToRenderer(mainWindow, 'update-status', {
      status: 'error',
      error: err.message,
    });
  });

  // ---- IPC handlers (renderer → main) ----

  ipcMain.handle('updater:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo ?? null;
    } catch (err: any) {
      logger.error('updater', 'Check failed', err.message);
      return null;
    }
  });

  ipcMain.handle('updater:download', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return true;
    } catch (err: any) {
      logger.error('updater', 'Download failed', err.message);
      return false;
    }
  });

  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle('updater:get-version', () => {
    return require('electron').app.getVersion();
  });

  // Check for updates on launch (after a short delay so the window loads first)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      logger.warn('updater', 'Startup update check failed', err.message);
    });
  }, 5000);
}

function sendToRenderer(win: BrowserWindow, channel: string, data: any): void {
  if (!win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}
