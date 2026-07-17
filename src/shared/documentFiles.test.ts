import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_CATEGORIES,
  formatBytes,
  isDocumentCategory,
  sanitizeFilename,
  uniqueStoredName,
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

describe('isDocumentCategory', () => {
  it('accepts every declared category and rejects the rest', () => {
    for (const c of DOCUMENT_CATEGORIES) expect(isDocumentCategory(c)).toBe(true);
    expect(isDocumentCategory('invoices')).toBe(false);
    expect(isDocumentCategory(3)).toBe(false);
    expect(isDocumentCategory(null)).toBe(false);
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
