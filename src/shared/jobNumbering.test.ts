import { describe, it, expect } from 'vitest';
import { parseJobNumberFormat, nextJobNumber } from './jobNumbering';

describe('parseJobNumberFormat', () => {
  it('splits prefix / counter / suffix', () => {
    expect(parseJobNumberFormat('JOB-NNNN', 2026)).toEqual({ prefix: 'JOB-', pad: 4, suffix: '' });
    expect(parseJobNumberFormat('NNN', 2026)).toEqual({ prefix: '', pad: 3, suffix: '' });
    expect(parseJobNumberFormat('NNN/B', 2026)).toEqual({ prefix: '', pad: 3, suffix: '/B' });
  });

  it('substitutes YYYY with the given year', () => {
    expect(parseJobNumberFormat('YYYY-NNN', 2026)).toEqual({ prefix: '2026-', pad: 3, suffix: '' });
  });

  it('uses the longest N-run as the counter, not a literal N in a word', () => {
    expect(parseJobNumberFormat('NEWTON-NN', 2026)).toEqual({ prefix: 'NEWTON-', pad: 2, suffix: '' });
  });

  it('returns null when the format has no counter', () => {
    expect(parseJobNumberFormat('YYYY', 2026)).toBeNull();
    expect(parseJobNumberFormat('', 2026)).toBeNull();
  });
});

describe('nextJobNumber', () => {
  it('starts a fresh sequence at the configured start', () => {
    expect(nextJobNumber('NNNN', [], 1, 2026)).toBe('0001');
    expect(nextJobNumber('JOB-NNNN', [], 100, 2026)).toBe('JOB-0100');
  });

  it('increments past the highest matching number', () => {
    expect(nextJobNumber('NNN', ['001', '007', '003'], 1, 2026)).toBe('008');
    expect(nextJobNumber('YYYY-NNN', ['2026-041', '2026-042'], 1, 2026)).toBe('2026-043');
  });

  it('floors at start even when existing numbers are lower', () => {
    expect(nextJobNumber('NNN', ['002'], 50, 2026)).toBe('050');
  });

  it('ignores numbers that do not match the format', () => {
    expect(
      nextJobNumber('YYYY-NNN', ['2025-099', 'JOB-500', 'misc', null, undefined, ''], 1, 2026)
    ).toBe('2026-001');
  });

  it('restarts each year for YYYY formats', () => {
    const existing = ['2026-041', '2026-042'];
    expect(nextJobNumber('YYYY-NNN', existing, 1, 2027)).toBe('2027-001');
  });

  it('keeps sequences that outgrow the padding', () => {
    expect(nextJobNumber('NNN', ['999'], 1, 2026)).toBe('1000');
    expect(nextJobNumber('NNN', ['1000'], 1, 2026)).toBe('1001');
  });

  it('matches trimmed values and tolerates junk in the list', () => {
    expect(nextJobNumber('JOB-NN', ['  JOB-09  ', 'JOB-1X'], 1, 2026)).toBe('JOB-10');
  });

  it('returns null for a format with no counter', () => {
    expect(nextJobNumber('YYYY', ['2026'], 1, 2026)).toBeNull();
  });

  it('sanitizes a nonsense start value', () => {
    expect(nextJobNumber('NNN', [], 0, 2026)).toBe('001');
    expect(nextJobNumber('NNN', [], NaN as any, 2026)).toBe('001');
  });
});
