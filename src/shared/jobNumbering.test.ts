import { describe, it, expect } from 'vitest';
import { parseJobNumberFormat, nextJobNumber } from './jobNumbering';

const JUL_2026 = new Date(2026, 6, 15);
const AUG_2026 = new Date(2026, 7, 3);
const JAN_2027 = new Date(2027, 0, 2);

describe('parseJobNumberFormat', () => {
  it('splits prefix / counter / suffix', () => {
    expect(parseJobNumberFormat('JOB-NNNN', JUL_2026)).toEqual({ prefix: 'JOB-', pad: 4, suffix: '' });
    expect(parseJobNumberFormat('NNN', JUL_2026)).toEqual({ prefix: '', pad: 3, suffix: '' });
    expect(parseJobNumberFormat('NNN/B', JUL_2026)).toEqual({ prefix: '', pad: 3, suffix: '/B' });
  });

  it('substitutes YYYY, YY, and MM date tokens', () => {
    expect(parseJobNumberFormat('YYYY-NNN', JUL_2026)).toEqual({ prefix: '2026-', pad: 3, suffix: '' });
    expect(parseJobNumberFormat('YY-NNN', JUL_2026)).toEqual({ prefix: '26-', pad: 3, suffix: '' });
    expect(parseJobNumberFormat('YYYY-MM-NNN', JUL_2026)).toEqual({ prefix: '2026-07-', pad: 3, suffix: '' });
    // Single-digit years of the century still pad to two
    expect(parseJobNumberFormat('YY-NNN', new Date(2109, 0, 1))).toEqual({ prefix: '09-', pad: 3, suffix: '' });
  });

  it('uses the longest N-run as the counter, not a literal N in a word', () => {
    expect(parseJobNumberFormat('NEWTON-NN', JUL_2026)).toEqual({ prefix: 'NEWTON-', pad: 2, suffix: '' });
  });

  it('returns null when the format has no counter', () => {
    expect(parseJobNumberFormat('YYYY', JUL_2026)).toBeNull();
    expect(parseJobNumberFormat('', JUL_2026)).toBeNull();
  });
});

describe('nextJobNumber', () => {
  it('starts a fresh sequence at the configured start', () => {
    expect(nextJobNumber('NNNN', [], 1, JUL_2026)).toBe('0001');
    expect(nextJobNumber('JOB-NNNN', [], 100, JUL_2026)).toBe('JOB-0100');
  });

  it('increments past the highest matching number', () => {
    expect(nextJobNumber('NNN', ['001', '007', '003'], 1, JUL_2026)).toBe('008');
    expect(nextJobNumber('YYYY-NNN', ['2026-041', '2026-042'], 1, JUL_2026)).toBe('2026-043');
  });

  it('floors at start even when existing numbers are lower', () => {
    expect(nextJobNumber('NNN', ['002'], 50, JUL_2026)).toBe('050');
  });

  it('ignores numbers that do not match the format', () => {
    expect(
      nextJobNumber('YYYY-NNN', ['2025-099', 'JOB-500', 'misc', null, undefined, ''], 1, JUL_2026)
    ).toBe('2026-001');
  });

  it('restarts each year for year formats', () => {
    const existing = ['2026-041', '2026-042'];
    expect(nextJobNumber('YYYY-NNN', existing, 1, JAN_2027)).toBe('2027-001');
    expect(nextJobNumber('YY-NNN', ['26-009'], 1, JUL_2026)).toBe('26-010');
    expect(nextJobNumber('YY-NNN', ['26-009'], 1, JAN_2027)).toBe('27-001');
  });

  it('restarts each month for MM formats', () => {
    const july = ['2026-07-004', '2026-07-011'];
    expect(nextJobNumber('YYYY-MM-NNN', july, 1, JUL_2026)).toBe('2026-07-012');
    expect(nextJobNumber('YYYY-MM-NNN', july, 1, AUG_2026)).toBe('2026-08-001');
  });

  it('keeps sequences that outgrow the padding', () => {
    expect(nextJobNumber('NNN', ['999'], 1, JUL_2026)).toBe('1000');
    expect(nextJobNumber('NNN', ['1000'], 1, JUL_2026)).toBe('1001');
  });

  it('matches trimmed values and tolerates junk in the list', () => {
    expect(nextJobNumber('JOB-NN', ['  JOB-09  ', 'JOB-1X'], 1, JUL_2026)).toBe('JOB-10');
  });

  it('returns null for a format with no counter', () => {
    expect(nextJobNumber('YYYY', ['2026'], 1, JUL_2026)).toBeNull();
  });

  it('sanitizes a nonsense start value', () => {
    expect(nextJobNumber('NNN', [], 0, JUL_2026)).toBe('001');
    expect(nextJobNumber('NNN', [], NaN as any, JUL_2026)).toBe('001');
  });
});
