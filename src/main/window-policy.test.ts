import { describe, it, expect } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';
import { appEntryUrl, isAllowedNavigation } from './window-policy';

/**
 * The regression these pin: `will-navigate` used to allow ANY `file://` URL,
 * so dropping a file on the window navigated to it — losing the open bid to
 * Chromium's PDF viewer at best, and running a dropped HTML file with the
 * preload injected at worst.
 */
describe('appEntryUrl', () => {
  it('is the packaged renderer entry, as a real file URL', () => {
    const url = appEntryUrl(false, '/opt/BidSheet/resources/app.asar/dist/main');
    expect(url).toBe(
      pathToFileURL(
        path.resolve('/opt/BidSheet/resources/app.asar/dist/main', '../renderer/index.html')
      ).href
    );
    expect(url.startsWith('file://')).toBe(true);
    expect(url.endsWith('/dist/renderer/index.html')).toBe(true);
  });

  it('is the dev server root in development', () => {
    expect(appEntryUrl(true, '/anywhere')).toBe('http://localhost:5173/');
  });
});

describe('isAllowedNavigation', () => {
  const prod = appEntryUrl(false, '/opt/app/dist/main');
  const dev = appEntryUrl(true, '/anywhere');

  it('allows the entry page itself', () => {
    expect(isAllowedNavigation(prod, prod)).toBe(true);
    expect(isAllowedNavigation(dev, dev)).toBe(true);
  });

  it('allows a hash route and a cache-busting query on the same document', () => {
    expect(isAllowedNavigation(`${prod}#/jobs/12`, prod)).toBe(true);
    expect(isAllowedNavigation('http://localhost:5173/?t=1738', dev)).toBe(true);
    expect(isAllowedNavigation('http://localhost:5173', dev)).toBe(true);
  });

  it('blocks a dropped PDF — the case that ate unsaved bid edits', () => {
    expect(isAllowedNavigation('file:///home/bob/plans/SmithPh2.pdf', prod)).toBe(false);
  });

  it('blocks a dropped HTML file, which would run with the preload injected', () => {
    expect(isAllowedNavigation('file:///home/bob/Downloads/bid-form-2026.html', prod)).toBe(false);
  });

  it('blocks a sibling file:// document next to the real entry', () => {
    expect(isAllowedNavigation(prod.replace('index.html', 'evil.html'), prod)).toBe(false);
  });

  it('blocks remote origins and non-http schemes', () => {
    for (const url of [
      'https://evil.example/',
      'http://localhost:5174/',
      'http://localhost:5173.evil.example/',
      'data:text/html,<script>alert(1)</script>',
      'javascript:alert(1)',
      'about:blank',
    ]) {
      expect(isAllowedNavigation(url, prod)).toBe(false);
      expect(isAllowedNavigation(url, dev)).toBe(false);
    }
  });

  it('does not let a query string smuggle a different target', () => {
    expect(isAllowedNavigation('file:///etc/passwd?x=' + prod, prod)).toBe(false);
    expect(isAllowedNavigation('https://evil.example/#' + prod, prod)).toBe(false);
  });
});
