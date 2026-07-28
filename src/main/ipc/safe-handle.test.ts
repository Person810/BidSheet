import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * safeHandle is the only place IPC errors get translated into something a
 * contractor can act on ("Disk is full") and written to the support log.
 * Most handlers it wraps are async, so the wrapper has to AWAIT them — an
 * unawaited promise settles outside the try/catch and the renderer gets the
 * raw errno instead. These tests pin the async path specifically; the sync
 * path never regressed and is covered incidentally by every other IPC test.
 */
const handlers = new Map<string, (event: any, ...args: any[]) => any>();
const logged: { channel: string; message: string }[] = [];

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', whenReady: () => Promise.resolve() },
  ipcMain: { handle: (channel: string, fn: any) => handlers.set(channel, fn) },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../logger', () => ({
  logger: {
    error: (channel: string, message: string) => logged.push({ channel, message }),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { safeHandle } from './shared';

const call = (channel: string, ...args: any[]) => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error('handler not registered');
  return fn(null, ...args);
};

const coded = (code: string, message: string) => {
  const err: any = new Error(message);
  err.code = code;
  return err;
};

describe('safeHandle', () => {
  beforeEach(() => {
    handlers.clear();
    logged.length = 0;
  });

  it('translates a coded error thrown by an ASYNC handler', async () => {
    safeHandle('test:async-enospc', async () => {
      throw coded('ENOSPC', 'ENOSPC: no space left on device, write');
    });
    await expect(call('test:async-enospc')).rejects.toThrow('Disk is full. Free some space and try again.');
  });

  it('logs a coded error thrown by an ASYNC handler', async () => {
    safeHandle('test:async-busy', async () => {
      throw coded('SQLITE_BUSY', 'database is locked');
    });
    await expect(call('test:async-busy')).rejects.toThrow(/Database is busy/);
    expect(logged).toEqual([
      { channel: 'test:async-busy', message: 'Database is busy. Try again in a moment.' },
    ]);
  });

  it('translates a coded error thrown by a SYNC handler', async () => {
    safeHandle('test:sync-enospc', () => {
      throw coded('ENOSPC', 'ENOSPC: no space left on device, write');
    });
    await expect(call('test:sync-enospc')).rejects.toThrow('Disk is full. Free some space and try again.');
  });

  it('passes a deliberate (uncoded) message through untranslated', async () => {
    safeHandle('test:deliberate', async () => {
      throw new Error('A client named Smith Construction already exists.');
    });
    await expect(call('test:deliberate')).rejects.toThrow(
      'A client named Smith Construction already exists.'
    );
  });

  it('resolves an async handler to its value', async () => {
    safeHandle('test:ok', async (_e: any, n: number) => n * 2);
    await expect(call('test:ok', 21)).resolves.toBe(42);
    expect(logged).toHaveLength(0);
  });
});
