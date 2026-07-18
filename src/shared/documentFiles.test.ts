import { describe, expect, it } from 'vitest';
import {
  buildFolderTree,
  descendantIds,
  folderPath,
  formatBytes,
  sanitizeFilename,
  uniqueSiblingFolderName,
  uniqueStoredName,
  type FolderLike,
} from './documentFiles';

describe('sanitizeFilename', () => {
  it('keeps ordinary names untouched', () => {
    expect(sanitizeFilename('Addendum 2.pdf')).toBe('Addendum 2.pdf');
    expect(sanitizeFilename('geotech-report_final.docx')).toBe('geotech-report_final.docx');
  });

  it('strips directory fragments from both path styles', () => {
    expect(sanitizeFilename('/home/user/plans.pdf')).toBe('plans.pdf');
    expect(sanitizeFilename('C:\\Bids\\plans.pdf')).toBe('plans.pdf');
  });

  it('replaces Windows-reserved characters', () => {
    expect(sanitizeFilename('spec: rev "A" <final>?.pdf')).toBe('spec_ rev _A_ _final__.pdf');
  });

  it('never returns an empty or dot-only name', () => {
    expect(sanitizeFilename('')).toBe('document');
    expect(sanitizeFilename('...')).toBe('document');
    expect(sanitizeFilename('///')).toBe('document');
  });
});

describe('uniqueStoredName', () => {
  it('returns the sanitized name when free', () => {
    expect(uniqueStoredName('plan.pdf', [])).toBe('plan.pdf');
  });

  it('suffixes before the extension on collision', () => {
    expect(uniqueStoredName('plan.pdf', ['plan.pdf'])).toBe('plan (2).pdf');
    expect(uniqueStoredName('plan.pdf', ['plan.pdf', 'plan (2).pdf'])).toBe('plan (3).pdf');
  });

  it('collides case-insensitively (Windows filesystems)', () => {
    expect(uniqueStoredName('Plan.PDF', ['plan.pdf'])).toBe('Plan (2).PDF');
  });

  it('handles extensionless and dotfile names', () => {
    expect(uniqueStoredName('README', ['README'])).toBe('README (2)');
    expect(uniqueStoredName('.env', ['.env'])).toBe('.env (2)');
  });
});

describe('uniqueSiblingFolderName', () => {
  it('returns the name unchanged when no sibling has it', () => {
    expect(uniqueSiblingFolderName('Plans', [])).toBe('Plans');
    expect(uniqueSiblingFolderName('Plans', ['Photos', 'Quotes'])).toBe('Plans');
  });

  it('appends " - Copy" on the first collision, Windows-style', () => {
    expect(uniqueSiblingFolderName('Plans', ['Plans'])).toBe('Plans - Copy');
  });

  it('numbers further copies', () => {
    expect(uniqueSiblingFolderName('Plans', ['Plans', 'Plans - Copy'])).toBe('Plans - Copy (2)');
    expect(uniqueSiblingFolderName('Plans', ['Plans', 'Plans - Copy', 'Plans - Copy (2)'])).toBe('Plans - Copy (3)');
  });

  it('collides case-insensitively', () => {
    expect(uniqueSiblingFolderName('plans', ['Plans'])).toBe('plans - Copy');
    expect(uniqueSiblingFolderName('Plans', ['plans', 'PLANS - copy'])).toBe('Plans - Copy (2)');
  });
});

describe('formatBytes', () => {
  it('picks sensible units', () => {
    expect(formatBytes(48)).toBe('48 B');
    expect(formatBytes(320 * 1024)).toBe('320 KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatBytes(2.25 * 1024 * 1024 * 1024)).toBe('2.25 GB');
  });

  it('shows -- for garbage', () => {
    expect(formatBytes(-1)).toBe('--');
    expect(formatBytes(NaN)).toBe('--');
  });
});

const flatFolders: FolderLike[] = [
  { id: 1, parent_id: null, name: 'Plans', sort_order: 0 },
  { id: 2, parent_id: null, name: 'Quotes', sort_order: 1 },
  { id: 3, parent_id: 1, name: 'Addenda', sort_order: 0 },
  { id: 4, parent_id: 3, name: 'Revision 2', sort_order: 0 },
  { id: 5, parent_id: 1, name: 'Structural', sort_order: 1 },
];

describe('buildFolderTree', () => {
  it('nests children under their parent and roots at the top', () => {
    const tree = buildFolderTree(flatFolders);
    expect(tree.map((n) => n.name)).toEqual(['Plans', 'Quotes']);
    const plans = tree[0];
    expect(plans.children.map((c) => c.name)).toEqual(['Addenda', 'Structural']);
    expect(plans.children[0].children.map((c) => c.name)).toEqual(['Revision 2']);
  });

  it('orders siblings by sort_order then name', () => {
    const unordered: FolderLike[] = [
      { id: 1, parent_id: null, name: 'Zebra', sort_order: 0 },
      { id: 2, parent_id: null, name: 'Apple', sort_order: 0 },
    ];
    expect(buildFolderTree(unordered).map((n) => n.name)).toEqual(['Apple', 'Zebra']);
  });

  it('treats a folder with a dangling parent_id as a root instead of dropping it', () => {
    const withDangling: FolderLike[] = [
      { id: 1, parent_id: 999, name: 'Orphan', sort_order: 0 },
    ];
    expect(buildFolderTree(withDangling).map((n) => n.name)).toEqual(['Orphan']);
  });

  it('returns an empty tree for no folders', () => {
    expect(buildFolderTree([])).toEqual([]);
  });
});

describe('descendantIds', () => {
  it('includes the folder itself and every level of nested children', () => {
    expect(descendantIds(flatFolders, 1)).toEqual(new Set([1, 3, 4, 5]));
  });

  it('is just the folder itself for a leaf', () => {
    expect(descendantIds(flatFolders, 4)).toEqual(new Set([4]));
  });

  it('does not include siblings or unrelated folders', () => {
    const ids = descendantIds(flatFolders, 3);
    expect(ids).toEqual(new Set([3, 4]));
    expect(ids.has(5)).toBe(false);
    expect(ids.has(2)).toBe(false);
  });
});

describe('folderPath', () => {
  it('builds the breadcrumb from root to the given folder', () => {
    expect(folderPath(flatFolders, 4)).toEqual(['Plans', 'Addenda', 'Revision 2']);
    expect(folderPath(flatFolders, 1)).toEqual(['Plans']);
  });

  it('is empty at root (null id)', () => {
    expect(folderPath(flatFolders, null)).toEqual([]);
  });

  it('is empty for an id that is not in the list', () => {
    expect(folderPath(flatFolders, 999)).toEqual([]);
  });
});
