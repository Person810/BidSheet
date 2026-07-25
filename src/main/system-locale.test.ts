import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, dialog: {} }));

describe('once-per-session Electron system locale', () => {
  it('waits for app readiness before reading the regional locale', async () => {
    const { createSystemLocaleReader } = await import('./system-locale');
    let releaseReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    const getSystemLocale = vi.fn(() => 'en-AU');
    const readLocale = createSystemLocaleReader({
      whenReady: () => ready,
      getSystemLocale,
    });

    const pending = readLocale();
    expect(getSystemLocale).not.toHaveBeenCalled();

    releaseReady();
    await expect(pending).resolves.toBe('en-AU');
    expect(getSystemLocale).toHaveBeenCalledTimes(1);
  });

  it('caches the first locale for the lifetime of the app session', async () => {
    const { createSystemLocaleReader } = await import('./system-locale');
    const getSystemLocale = vi
      .fn<() => string>()
      .mockReturnValueOnce('en-AU')
      .mockReturnValue('en-US');
    const readLocale = createSystemLocaleReader({
      whenReady: () => Promise.resolve(),
      getSystemLocale,
    });

    await expect(readLocale()).resolves.toBe('en-AU');
    await expect(readLocale()).resolves.toBe('en-AU');
    expect(getSystemLocale).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, '', '   '])(
    'returns an empty locale for an unavailable value (%s)',
    async (unavailable) => {
      const { createSystemLocaleReader } = await import('./system-locale');
      const readLocale = createSystemLocaleReader({
        whenReady: () => Promise.resolve(),
        getSystemLocale: () => unavailable,
      });

      await expect(readLocale()).resolves.toBe('');
    },
  );

  it('returns an empty locale when Electron locale detection throws', async () => {
    const { createSystemLocaleReader } = await import('./system-locale');
    const readLocale = createSystemLocaleReader({
      whenReady: () => Promise.resolve(),
      getSystemLocale: () => {
        throw new Error('regional settings unavailable');
      },
    });

    await expect(readLocale()).resolves.toBe('');
    await expect(readLocale()).resolves.toBe('');
  });
});
