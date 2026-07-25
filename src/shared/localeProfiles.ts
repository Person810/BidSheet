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
  if (userPreference && LOCALE_PROFILES[userPreference]) {
    return LOCALE_PROFILES[userPreference];
  }
  return LOCALE_PROFILES[osLocale] ?? LOCALE_PROFILES[DEFAULT_LOCALE];
}
