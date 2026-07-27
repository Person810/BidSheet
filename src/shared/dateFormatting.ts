import { resolveLocaleProfile } from './localeProfiles';

export type DateFormatPreference = 'system' | 'dmy' | 'mdy' | 'ymd';
export type DateOrder = Exclude<DateFormatPreference, 'system'>;

export interface ResolvedDateOrder {
  order: DateOrder;
  source: 'preference' | 'system' | 'fallback';
}

const preferences: readonly DateFormatPreference[] = ['system', 'dmy', 'mdy', 'ymd'];
const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateFormatPreference(value: unknown): value is DateFormatPreference {
  return typeof value === 'string'
    && preferences.includes(value as DateFormatPreference);
}

export function validateDateFormatPreference(value: unknown): DateFormatPreference {
  if (!isDateFormatPreference(value)) {
    throw new Error('Invalid date format preference');
  }
  return value;
}

export function resolveDateOrder(
  preference: DateFormatPreference,
  locale?: string,
): ResolvedDateOrder {
  validateDateFormatPreference(preference);
  if (preference !== 'system') {
    return { order: preference, source: 'preference' };
  }
  
  if (!locale) {
    return { order: 'ymd', source: 'fallback' };
  }
  
  // Use LocaleProfile as the single source of truth for the system date format
  const systemProfile = resolveLocaleProfile(locale);
  return { order: systemProfile.dateFormat, source: 'system' };
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function canonicalDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseCanonical(value: string): [number, number, number] | null {
  const match = isoDatePattern.exec(value);
  if (!match) return null;
  const parts: [number, number, number] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  return isValidDate(...parts) ? parts : null;
}

export function formatBusinessDate(
  value: string,
  preference: DateFormatPreference,
  locale?: string,
): string {
  if (value.trim() === '') return '';
  const prefix = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(value);
  const parts = prefix ? parseCanonical(prefix[1]) : null;
  if (!parts) return value;

  const [year, month, day] = parts;
  switch (resolveDateOrder(preference, locale).order) {
    case 'dmy': return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
    case 'mdy': return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${year}`;
    case 'ymd': return canonicalDate(year, month, day);
  }
}

export function parseBusinessDate(
  input: string,
  preference: DateFormatPreference,
  locale?: string,
): string | null {
  if (input.trim() === '') return null;
  const order = resolveDateOrder(preference, locale).order;
  const pattern = order === 'ymd'
    ? /^(\d{4})-(\d{2})-(\d{2})$/
    : /^(\d{2})\/(\d{2})\/(\d{4})$/;
  const match = pattern.exec(input);
  if (!match) throw new Error(`Date does not match the required ${order.toUpperCase()} format`);

  let year: number;
  let month: number;
  let day: number;
  if (order === 'ymd') {
    [, year, month, day] = match.map(Number);
  } else {
    year = Number(match[3]);
    day = Number(match[order === 'dmy' ? 1 : 2]);
    month = Number(match[order === 'dmy' ? 2 : 1]);
  }
  if (!isValidDate(year, month, day)) throw new Error('Date is not a valid calendar date');
  return canonicalDate(year, month, day);
}

export function localTodayIso(now: Date = new Date()): string {
  return canonicalDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function calendarDaysBetween(start: string, end: string): number {
  const startParts = parseCanonical(start);
  const endParts = parseCanonical(end);
  if (!startParts || !endParts) throw new Error('A valid canonical date is required');
  const startUtc = Date.UTC(startParts[0], startParts[1] - 1, startParts[2]);
  const endUtc = Date.UTC(endParts[0], endParts[1] - 1, endParts[2]);
  return (endUtc - startUtc) / 86_400_000;
}
