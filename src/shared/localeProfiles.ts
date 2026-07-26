export interface LocaleProfile {
  id: string;
  displayName: string;
  dateFormat: 'dmy' | 'mdy' | 'ymd';
  taxLabel: string;
  postalLabel: string;
  gcLabel: string;
  currencySymbol: string;
  thousandsSep: string;
  decimalSep: string;
}

export const LOCALE_PROFILES: Record<string, LocaleProfile> = {
  'en-US': { id: 'en-US', displayName: 'United States', dateFormat: 'mdy', taxLabel: 'Sales Tax', postalLabel: 'Zip Code', gcLabel: 'GC / Owner', currencySymbol: '$', thousandsSep: ',', decimalSep: '.' },
  'en-AU': { id: 'en-AU', displayName: 'Australia', dateFormat: 'dmy', taxLabel: 'GST', postalLabel: 'Postcode', gcLabel: 'Builder', currencySymbol: '$', thousandsSep: ',', decimalSep: '.' },
  'en-GB': { id: 'en-GB', displayName: 'United Kingdom', dateFormat: 'dmy', taxLabel: 'VAT', postalLabel: 'Postcode', gcLabel: 'Main Contractor', currencySymbol: '£', thousandsSep: ',', decimalSep: '.' },
  'en-NZ': { id: 'en-NZ', displayName: 'New Zealand', dateFormat: 'dmy', taxLabel: 'GST', postalLabel: 'Postcode', gcLabel: 'Main Contractor', currencySymbol: '$', thousandsSep: ',', decimalSep: '.' },
  'en-CA': { id: 'en-CA', displayName: 'Canada', dateFormat: 'ymd', taxLabel: 'HST', postalLabel: 'Postal Code', gcLabel: 'GC / Owner', currencySymbol: '$', thousandsSep: ',', decimalSep: '.' },
};

export const DEFAULT_LOCALE = 'en-US';

export function resolveLocaleProfile(
  osLocale: string,
  userPreference?: string | null,
): LocaleProfile {
  // 1. Try to resolve user preference if provided
  if (userPreference) {
    const normalizedPref = userPreference.replace('_', '-').trim();
    const matchPref = findProfile(normalizedPref);
    if (matchPref) return matchPref;
  }

  // 2. Try to resolve OS locale
  const normalizedOS = (osLocale || '').replace('_', '-').trim();
  if (normalizedOS) {
    const matchOS = findProfile(normalizedOS);
    if (matchOS) return matchOS;
  }

  // 3. Dynamic resolution or fallback using the selected tag
  const fallbackTag = userPreference || osLocale || DEFAULT_LOCALE;
  const normalizedFallback = fallbackTag.replace('_', '-').trim();
  const matchFallback = findProfile(normalizedFallback);
  if (matchFallback) return matchFallback;

  const defaultProfile = LOCALE_PROFILES[DEFAULT_LOCALE];

  // Dynamically resolve dateFormat using Intl.DateTimeFormat for arbitrary locales
  let resolvedFormat: 'dmy' | 'mdy' | 'ymd' = defaultProfile.dateFormat;
  try {
    if (Intl.DateTimeFormat.supportedLocalesOf([normalizedFallback]).length > 0) {
      const parts = new Intl.DateTimeFormat(normalizedFallback, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'UTC',
      }).formatToParts(new Date(Date.UTC(2006, 10, 22)));
      const order = parts
        .filter((part) => part.type === 'year' || part.type === 'month' || part.type === 'day')
        .map((part) => part.type[0])
        .join('');
      if (order === 'dmy' || order === 'mdy' || order === 'ymd') {
        resolvedFormat = order;
      }
    }
  } catch {
    // Fallback
  }

  return {
    ...defaultProfile,
    dateFormat: resolvedFormat,
  };
}

function findProfile(localeTag: string): LocaleProfile | undefined {
  const keys = Object.keys(LOCALE_PROFILES);
  // 1. Case-insensitive exact match
  const exact = keys.find((k) => k.toLowerCase() === localeTag.toLowerCase());
  if (exact) return LOCALE_PROFILES[exact];

  // 2. Prefix matching (e.g. "en" -> "en-US", "en-au" -> "en-AU")
  const lang = localeTag.split('-')[0].toLowerCase();
  const prefixMatches = keys.filter((k) => k.split('-')[0].toLowerCase() === lang);
  if (prefixMatches.length > 0) {
    const preferred = prefixMatches.find(
      (k) => k.toLowerCase() === `${lang}-${lang}` || k === 'en-US'
    );
    return LOCALE_PROFILES[preferred || prefixMatches[0]];
  }

  return undefined;
}
