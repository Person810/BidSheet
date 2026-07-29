/**
 * Pins the electron alias in vitest.config.ts.
 *
 * This file deliberately does NOT call vi.mock('electron'). It imports the real
 * module id and asserts the import resolves — which is only true because
 * resolve.alias points 'electron' at test/electron-stub.ts.
 *
 * Without that alias this file would die on CI (which installs
 * --ignore-scripts, so the Electron binary is never downloaded) with "Electron
 * failed to install correctly", vitest would skip the whole suite file, every
 * other test would still pass, and the run would go red with a green-looking
 * summary. That exact trap fired three times — PdfViewer, main.ts, sync-engine.
 *
 * It would also pass locally either way, where Electron IS installed, so the
 * assertion below checks for the STUB specifically rather than merely for a
 * successful import. Delete the alias and this goes red on a developer machine,
 * not only in CI.
 */
import { describe, expect, it } from 'vitest';
import { app, BrowserWindow, ipcMain } from 'electron';

describe('electron test stub', () => {
  it('resolves the electron import without the real binary', () => {
    expect(app).toBeDefined();
    expect(ipcMain).toBeDefined();
    expect(BrowserWindow).toBeDefined();
  });

  it('is the stub, not the real electron module', () => {
    // The real app.getVersion() returns Electron's version; the stub is pinned.
    expect(app.getVersion()).toBe('0.0.0-test');
  });

  it('keeps getPath inside the OS temp dir', async () => {
    // Handlers under test do real filesystem work, and F07 was a traversal bug
    // that recursively deleted whatever this resolved to. A stray unmocked
    // getPath must never point at a developer's actual userData directory.
    const os = await import('node:os');
    expect(app.getPath('userData').startsWith(os.tmpdir())).toBe(true);
  });
});
