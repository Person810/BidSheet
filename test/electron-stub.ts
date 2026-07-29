/**
 * Fallback stub for the `electron` module in tests.
 *
 * WHY THIS EXISTS
 * ---------------
 * CI installs with `--ignore-scripts` (deliberately — it stops dependency
 * postinstalls from running arbitrary code), so the Electron binary is never
 * downloaded. Any test that transitively imports `electron` then dies with
 * "Electron failed to install correctly". Vitest skips that whole suite file
 * while every other test still passes, so the run goes red with a
 * green-looking summary — and it does NOT reproduce locally, where Electron IS
 * installed.
 *
 * That trap fired three times before this file existed: PdfViewer (0d7fa7a,
 * supersampleFactor), main.ts (split into window-policy.ts), and sync-engine
 * (dec30a7, assertCloudId -> cloud-id.ts). Each time the fix was to move the
 * pure function somewhere that doesn't import electron. That is still good
 * design — it just should not be the only thing standing between the suite and
 * a false green.
 *
 * PRECEDENCE
 * ----------
 * This is a FALLBACK, wired via `resolve.alias` in vitest.config.ts. A test
 * that calls `vi.mock('electron', ...)` still wins: vitest applies the alias
 * first and registers the mock against the resolved id, so the 18 suites that
 * already mock electron are unaffected. Reach for vi.mock when you need
 * specific behaviour; rely on this when you just need the import not to
 * explode.
 *
 * The members here are the ones the app actually imports. If a test needs one
 * that isn't stubbed, add it — but prefer vi.mock in the test if the behaviour
 * is what you're asserting on.
 */
import os from 'os';
import path from 'path';

// Deliberately inside the OS temp dir. Handlers under test do real filesystem
// work (removeJobFiles, backup copies, plan writes), and F07 was a traversal
// bug that recursively deleted whatever this resolved to. A stray unmocked
// getPath must never point at anything real.
const STUB_ROOT = path.join(os.tmpdir(), 'bidsheet-test-userdata');

const noop = () => undefined;

export const app = {
  getPath: (name: string) => path.join(STUB_ROOT, name),
  getName: () => 'BidSheet',
  getVersion: () => '0.0.0-test',
  getAppPath: () => STUB_ROOT,
  isPackaged: false,
  quit: noop,
  relaunch: noop,
  on: noop,
  once: noop,
  whenReady: () => Promise.resolve(),
};

export const ipcMain = {
  handle: noop,
  handleOnce: noop,
  on: noop,
  once: noop,
  removeHandler: noop,
};

export const ipcRenderer = {
  invoke: () => Promise.resolve(undefined),
  send: noop,
  on: noop,
  once: noop,
  removeListener: noop,
};

export const contextBridge = {
  exposeInMainWorld: noop,
};

export const dialog = {
  showOpenDialog: () => Promise.resolve({ canceled: true, filePaths: [] }),
  showSaveDialog: () => Promise.resolve({ canceled: true, filePath: undefined }),
  showMessageBox: () => Promise.resolve({ response: 0 }),
  showErrorBox: noop,
};

export const shell = {
  openPath: () => Promise.resolve(''),
  openExternal: () => Promise.resolve(),
  showItemInFolder: noop,
};

export const Menu = {
  setApplicationMenu: noop,
  buildFromTemplate: () => ({ popup: noop }),
};

export class BrowserWindow {
  static getAllWindows() {
    return [] as BrowserWindow[];
  }
  static fromWebContents() {
    return null;
  }
  webContents = {
    send: noop,
    on: noop,
    once: noop,
    setWindowOpenHandler: noop,
    printToPDF: () => Promise.resolve(Buffer.alloc(0)),
  };
  loadURL = () => Promise.resolve();
  loadFile = () => Promise.resolve();
  on = noop;
  once = noop;
  close = noop;
  destroy = noop;
  show = noop;
  isDestroyed = () => false;
}

export const session = {
  defaultSession: {
    webRequest: { onHeadersReceived: noop },
  },
};

export const nativeTheme = { shouldUseDarkColors: false, on: noop };

export default {
  app,
  ipcMain,
  ipcRenderer,
  contextBridge,
  dialog,
  shell,
  Menu,
  BrowserWindow,
  session,
  nativeTheme,
};
