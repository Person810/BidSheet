import { app } from 'electron';

export interface SystemLocaleSource {
  whenReady: () => Promise<unknown>;
  getSystemLocale: () => unknown;
}

/**
 * Build a session-scoped locale reader. Electron's regional locale is only
 * queried after readiness, then retained so every renderer and export path
 * observes the same convention until the application restarts.
 */
export function createSystemLocaleReader(
  source: SystemLocaleSource,
): () => Promise<string> {
  let localePromise: Promise<string> | undefined;

  return () => {
    localePromise ??= source.whenReady().then(() => {
      try {
        const locale = source.getSystemLocale();
        return typeof locale === 'string' ? locale.trim() : '';
      } catch {
        return '';
      }
    });
    return localePromise;
  };
}

export const readSystemLocale = createSystemLocaleReader({
  whenReady: () => app.whenReady(),
  getSystemLocale: () => app.getSystemLocale(),
});
