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
  /**
   * Whether the job tax rate applies to freight by default. A profile value
   * is only ever a default — app_settings.freight_taxable (0/1) overrides
   * it, NULL means "follow the locale". GST/VAT regimes tax domestic
   * freight; US sales tax on freight varies by state, so en-US defaults
   * off and the setting is the way to turn it on.
   */
  freightTaxable: boolean;
  /**
   * How a postal address is captured and rendered.
   *
   * 'structured' — the address is entered as separate street / suburb /
   * state / postcode fields and composed into the stored block. Australia
   * Post style, and the shape Australian builders expect on a quote.
   *
   * 'freeform' — the address is one multi-line text field, stored as typed.
   *
   * This replaces a hardcoded `profile.id === 'en-AU'` test. The behaviour is
   * a property of the locale, so a country that needs the structured form
   * should get it by adding a profile, not by editing a component.
   */
  addressFormat: 'structured' | 'freeform';
}

export const LOCALE_PROFILES: Record<string, LocaleProfile> = {
  'en-US': { id: 'en-US', displayName: 'United States', dateFormat: 'mdy', taxLabel: 'Sales Tax', postalLabel: 'Zip Code', gcLabel: 'GC / Owner', currencySymbol: '$', thousandsSep: ',', decimalSep: '.', freightTaxable: false, addressFormat: 'freeform' },
  'en-AU': { id: 'en-AU', displayName: 'Australia', dateFormat: 'dmy', taxLabel: 'GST', postalLabel: 'Postcode', gcLabel: 'Builder', currencySymbol: '$', thousandsSep: ',', decimalSep: '.', freightTaxable: true, addressFormat: 'structured' },
  'en-GB': { id: 'en-GB', displayName: 'United Kingdom', dateFormat: 'dmy', taxLabel: 'VAT', postalLabel: 'Postcode', gcLabel: 'Main Contractor', currencySymbol: '£', thousandsSep: ',', decimalSep: '.', freightTaxable: true, addressFormat: 'freeform' },
  'en-NZ': { id: 'en-NZ', displayName: 'New Zealand', dateFormat: 'dmy', taxLabel: 'GST', postalLabel: 'Postcode', gcLabel: 'Main Contractor', currencySymbol: '$', thousandsSep: ',', decimalSep: '.', freightTaxable: true, addressFormat: 'freeform' },
  'en-CA': { id: 'en-CA', displayName: 'Canada', dateFormat: 'ymd', taxLabel: 'HST', postalLabel: 'Postal Code', gcLabel: 'GC / Owner', currencySymbol: '$', thousandsSep: ',', decimalSep: '.', freightTaxable: true, addressFormat: 'freeform' },
};

export const DEFAULT_LOCALE = 'en-US';

export function resolveLocaleProfile(
  osLocale: string,
  userPreference?: string | null,
): LocaleProfile {
  // 1. Try to resolve user preference if provided
  const preference = normalizeTag(userPreference);
  const system = normalizeTag(osLocale);

  const matched = findProfile(preference) ?? findProfile(system);
  if (matched) return matched;

  // No registered profile for this tag. Keep the default labels — we have no
  // basis for inventing a tax name or a GC title — but resolve the date order
  // from the tag itself, so at least dates read the way the user expects.
  const defaultProfile = LOCALE_PROFILES[DEFAULT_LOCALE];
  return {
    ...defaultProfile,
    dateFormat: dateOrderFor(preference || system) ?? defaultProfile.dateFormat,
  };
}

/** POSIX (`en_AU.UTF-8`) and BCP-47 (`en-AU`) both reduce to `en-AU`. */
function normalizeTag(localeTag: string | null | undefined): string {
  return (localeTag ?? '').split('.')[0].replace(/_/g, '-').trim();
}

/**
 * BCP-47 lookup: try the whole tag, then drop subtags right to left, so
 * `en-AU-u-ca-gregory` finds `en-AU`. Deliberately does NOT fall back to
 * "some other profile sharing the language" — that silently gave every
 * unregistered English locale (en-IE, en-ZA, en-IN…) US labels and US date
 * order, and made the Intl resolution below unreachable for them.
 */
function findProfile(localeTag: string): LocaleProfile | undefined {
  const keys = Object.keys(LOCALE_PROFILES);
  let candidate = localeTag;
  while (candidate) {
    const hit = keys.find((k) => k.toLowerCase() === candidate.toLowerCase());
    if (hit) return LOCALE_PROFILES[hit];
    const cut = candidate.lastIndexOf('-');
    if (cut < 0) return undefined;
    candidate = candidate.slice(0, cut);
  }
  return undefined;
}

/** Date field order Intl reports for a tag, or undefined if it can't say. */
function dateOrderFor(localeTag: string): 'dmy' | 'mdy' | 'ymd' | undefined {
  if (!localeTag) return undefined;
  try {
    if (Intl.DateTimeFormat.supportedLocalesOf([localeTag]).length === 0) {
      return undefined;
    }
    const order = new Intl.DateTimeFormat(localeTag, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC',
    })
      .formatToParts(new Date(Date.UTC(2006, 10, 22)))
      .filter((part) => part.type === 'year' || part.type === 'month' || part.type === 'day')
      .map((part) => part.type[0])
      .join('');
    return order === 'dmy' || order === 'mdy' || order === 'ymd' ? order : undefined;
  } catch {
    return undefined;
  }
}
