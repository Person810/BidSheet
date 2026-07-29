import path from 'path';
import { pathToFileURL } from 'url';

/**
 * Navigation policy for the main window.
 *
 * BidSheet is a single local page. It is also an app whose renderer parses
 * untrusted PDFs (plan rooms, GC emails) and whose preload exposes the entire
 * estimating database, so "what is this window allowed to become" is a
 * security question, not a routing one.
 *
 * The rule is one URL, pinned. Allowing a scheme instead — every `file://` —
 * meant any file dropped on the window navigated to it: a plan PDF replaced
 * the app with Chromium's PDF viewer, and a dropped HTML file executed with
 * the preload injected and no CSP of its own.
 *
 * Split out of main.ts so it can be tested without booting Electron.
 */

/** The one URL the main window is allowed to hold. */
export function appEntryUrl(isDev: boolean, mainDir: string): string {
  if (isDev) return 'http://localhost:5173/';
  return pathToFileURL(path.resolve(mainDir, '../renderer/index.html')).href;
}

/**
 * Whether `url` is that page. Query and hash are ignored — Vite appends them
 * on reload, and a hash route is the same document — but nothing else is.
 */
export function isAllowedNavigation(url: string, allowedUrl: string): boolean {
  if (url === allowedUrl) return true;
  const bare = url.split('#')[0].split('?')[0];
  return bare === allowedUrl || `${bare}/` === allowedUrl;
}
