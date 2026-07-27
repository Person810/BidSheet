import { describe, it, expect } from 'vitest';
import {
  formatBusinessDate,
  parseBusinessDate,
  resolveDateOrder,
  localTodayIso,
  calendarDaysBetween,
} from './dateFormatting';

describe('dateFormatting', () => {
  describe('formatBusinessDate', () => {
    it('formats canonical to dmy', () => {
      expect(formatBusinessDate('2023-10-25', 'dmy')).toBe('25/10/2023');
    });
    it('formats canonical to mdy', () => {
      expect(formatBusinessDate('2023-10-25', 'mdy')).toBe('10/25/2023');
    });
    it('formats canonical to ymd', () => {
      expect(formatBusinessDate('2023-10-25', 'ymd')).toBe('2023-10-25');
    });
    it('handles empty string', () => {
      expect(formatBusinessDate('', 'dmy')).toBe('');
    });
    it('passes through malformed input', () => {
      expect(formatBusinessDate('not a date', 'dmy')).toBe('not a date');
    });
  });

  describe('parseBusinessDate', () => {
    it('parses dmy input to canonical', () => {
      expect(parseBusinessDate('25/10/2023', 'dmy')).toBe('2023-10-25');
    });
    it('parses mdy input to canonical', () => {
      expect(parseBusinessDate('10/25/2023', 'mdy')).toBe('2023-10-25');
    });
    it('parses ymd input to canonical', () => {
      expect(parseBusinessDate('2023-10-25', 'ymd')).toBe('2023-10-25');
    });
    it('throws on invalid date (e.g. 31/02)', () => {
      expect(() => parseBusinessDate('31/02/2023', 'dmy')).toThrow();
    });
    it('returns null on empty input', () => {
      expect(parseBusinessDate('', 'dmy')).toBeNull();
    });
  });

  describe('resolveDateOrder', () => {
    it('respects explicit preference', () => {
      expect(resolveDateOrder('dmy').order).toBe('dmy');
      expect(resolveDateOrder('mdy').order).toBe('mdy');
    });
    it('returns dmy for system with en-AU locale', () => {
      expect(resolveDateOrder('system', 'en-AU').order).toBe('dmy');
    });
    it('returns mdy for system with en-US locale', () => {
      expect(resolveDateOrder('system', 'en-US').order).toBe('mdy');
    });
    it('returns ymd fallback for system with no locale', () => {
      expect(resolveDateOrder('system').order).toBe('ymd');
    });
  });

  describe('localTodayIso', () => {
    it('returns YYYY-MM-DD format string', () => {
      const result = localTodayIso();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('calendarDaysBetween', () => {
    it('returns correct day count', () => {
      expect(calendarDaysBetween('2023-10-25', '2023-10-30')).toBe(5);
    });
    it('handles DST boundary (mocked implicitly via UTC)', () => {
      expect(calendarDaysBetween('2023-10-31', '2023-11-01')).toBe(1);
    });
    it('throws on malformed input', () => {
      expect(() => calendarDaysBetween('not-a-date', '2023-10-30')).toThrow();
    });
  });
});
