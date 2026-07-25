/**
 * Calendar grid generation for the date picker dropdown.
 * Pure functions — no React dependencies.
 */

export interface CalendarDay {
  /** YYYY-MM-DD */
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
}

export interface CalendarMonth {
  year: number;
  month: number; // 1-12
  label: string; // e.g. "July 2026"
  days: CalendarDay[];
  weekdayHeaders: string[];
}

/**
 * Build a calendar grid for the given year/month.
 * Includes leading/trailing days from adjacent months to fill complete weeks.
 * Week starts on Monday (ISO standard).
 */
export function buildCalendarMonth(
  year: number,
  month: number,
  todayIso?: string,
): CalendarMonth {
  const today = todayIso ?? localToday();
  const firstOfMonth = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();

  // Monday=0, Tuesday=1, ... Sunday=6 (ISO weekday)
  let startDow = firstOfMonth.getDay() - 1;
  if (startDow < 0) startDow = 6; // Sunday wraps to 6

  const days: CalendarDay[] = [];

  // Leading days from previous month
  const prevMonthDays = new Date(year, month - 1, 0).getDate();
  for (let i = startDow - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const dateStr = isoDate(prevYear, prevMonth, d);
    days.push({ date: dateStr, day: d, inMonth: false, isToday: dateStr === today });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = isoDate(year, month, d);
    days.push({ date: dateStr, day: d, inMonth: true, isToday: dateStr === today });
  }

  // Trailing days to fill to complete weeks (up to 42 cells = 6 rows)
  const remaining = 42 - days.length;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  for (let d = 1; d <= remaining; d++) {
    const dateStr = isoDate(nextYear, nextMonth, d);
    days.push({ date: dateStr, day: d, inMonth: false, isToday: dateStr === today });
  }

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  return {
    year,
    month,
    label: `${monthNames[month - 1]} ${year}`,
    days,
    weekdayHeaders: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  };
}

/** Navigate to the previous month. */
export function prevMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** Navigate to the next month. */
export function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/** Parse a YYYY-MM-DD string into year and month. */
export function parseYearMonth(canonical: string | null): { year: number; month: number } {
  if (canonical) {
    const parts = canonical.split('-');
    if (parts.length >= 2) {
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      if (!isNaN(y) && !isNaN(m) && m >= 1 && m <= 12) {
        return { year: y, month: m };
      }
    }
  }
  // Default to current month
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function localToday(): string {
  const now = new Date();
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
