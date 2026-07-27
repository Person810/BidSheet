import { describe, expect, it } from 'vitest';
import {
  buildCalendarMonth,
  nextMonth,
  parseYearMonth,
  prevMonth,
} from './calendarGrid';

describe('buildCalendarMonth', () => {
  it('generates 42 days (6 rows × 7 cols)', () => {
    const cal = buildCalendarMonth(2026, 7, '2026-07-18');
    expect(cal.days).toHaveLength(42);
  });

  it('labels the month correctly', () => {
    const cal = buildCalendarMonth(2026, 7);
    expect(cal.label).toBe('July 2026');
  });

  it('has 7 weekday headers starting with Monday', () => {
    const cal = buildCalendarMonth(2026, 7);
    expect(cal.weekdayHeaders).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('marks current month days as inMonth=true', () => {
    const cal = buildCalendarMonth(2026, 7, '2026-07-01');
    const inMonth = cal.days.filter((d) => d.inMonth);
    expect(inMonth.length).toBe(31); // July has 31 days
  });

  it('marks today correctly', () => {
    const cal = buildCalendarMonth(2026, 7, '2026-07-18');
    const today = cal.days.find((d) => d.isToday);
    expect(today).toBeDefined();
    expect(today!.date).toBe('2026-07-18');
    expect(today!.day).toBe(18);
  });

  it('includes leading days from previous month', () => {
    // July 2026 starts on Wednesday → Mon, Tue are from June
    const cal = buildCalendarMonth(2026, 7, '2026-07-01');
    const leading = cal.days.filter((d) => !d.inMonth && d.date < '2026-07-01');
    expect(leading.length).toBeGreaterThan(0);
    expect(leading[0].inMonth).toBe(false);
  });

  it('handles February correctly', () => {
    const cal = buildCalendarMonth(2026, 2, '2026-02-15');
    const inMonth = cal.days.filter((d) => d.inMonth);
    expect(inMonth.length).toBe(28);
  });

  it('handles leap year February', () => {
    const cal = buildCalendarMonth(2028, 2, '2028-02-15');
    const inMonth = cal.days.filter((d) => d.inMonth);
    expect(inMonth.length).toBe(29);
  });

  it('generates valid ISO date strings for all days', () => {
    const cal = buildCalendarMonth(2026, 12, '2026-12-01');
    for (const d of cal.days) {
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('month navigation', () => {
  it('prevMonth wraps from January to December', () => {
    expect(prevMonth(2026, 1)).toEqual({ year: 2025, month: 12 });
  });

  it('prevMonth decrements within year', () => {
    expect(prevMonth(2026, 7)).toEqual({ year: 2026, month: 6 });
  });

  it('nextMonth wraps from December to January', () => {
    expect(nextMonth(2026, 12)).toEqual({ year: 2027, month: 1 });
  });

  it('nextMonth increments within year', () => {
    expect(nextMonth(2026, 7)).toEqual({ year: 2026, month: 8 });
  });
});

describe('parseYearMonth', () => {
  it('parses a valid canonical date', () => {
    expect(parseYearMonth('2026-07-18')).toEqual({ year: 2026, month: 7 });
  });

  it('returns current month for null', () => {
    const result = parseYearMonth(null);
    const now = new Date();
    expect(result.year).toBe(now.getFullYear());
    expect(result.month).toBe(now.getMonth() + 1);
  });

  it('returns current month for invalid string', () => {
    const result = parseYearMonth('not-a-date');
    const now = new Date();
    expect(result.year).toBe(now.getFullYear());
  });
});
