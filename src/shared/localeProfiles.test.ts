import { describe, it, expect } from 'vitest';
import { resolveLocaleProfile, LOCALE_PROFILES, LocaleProfile } from './localeProfiles';

describe('locale profile resolution', () => {
  it('resolves exact match (en-AU → en-AU profile)', () => {
    expect(resolveLocaleProfile('en-AU').id).toBe('en-AU');
  });
  
  it('resolves exact match (en-US → en-US profile)', () => {
    expect(resolveLocaleProfile('en-US').id).toBe('en-US');
  });
  
  it('resolves exact match (en-GB → en-GB profile)', () => {
    expect(resolveLocaleProfile('en-GB').id).toBe('en-GB');
  });
  
  it('falls back to en-US for unrecognised locale (de-DE → en-US)', () => {
    expect(resolveLocaleProfile('de-DE').id).toBe('en-US');
  });
  
  it('falls back to en-US for empty string', () => {
    expect(resolveLocaleProfile('').id).toBe('en-US');
  });
  
  it('user preference overrides OS locale (OS=en-AU, pref=en-GB → en-GB)', () => {
    expect(resolveLocaleProfile('en-AU', 'en-GB').id).toBe('en-GB');
  });
  
  it('user preference takes priority even when OS matches (OS=en-AU, pref=en-US → en-US)', () => {
    expect(resolveLocaleProfile('en-AU', 'en-US').id).toBe('en-US');
  });
  
  it('invalid user preference falls back to OS locale', () => {
    expect(resolveLocaleProfile('en-AU', 'invalid-pref').id).toBe('en-AU');
  });
  
  it('normalizes OS locale with underscores or mixed case (en_au → en-AU)', () => {
    expect(resolveLocaleProfile('en_au').id).toBe('en-AU');
    expect(resolveLocaleProfile('en-au').id).toBe('en-AU');
    expect(resolveLocaleProfile('EN-AU').id).toBe('en-AU');
  });
  
  it('matches prefix for bare language locale (en → en-US)', () => {
    expect(resolveLocaleProfile('en').id).toBe('en-US');
  });
  
  it('drops subtags right to left to find a registered profile', () => {
    expect(resolveLocaleProfile('en-AU-u-ca-gregory').id).toBe('en-AU');
    expect(resolveLocaleProfile('en-GB-oxendict').id).toBe('en-GB');
  });

  it('normalizes POSIX locale strings (en_AU.UTF-8 → en-AU)', () => {
    expect(resolveLocaleProfile('en_AU.UTF-8').id).toBe('en-AU');
    expect(resolveLocaleProfile('en_CA.utf8').id).toBe('en-CA');
  });

  it('resolves date order from the tag for unregistered English locales', () => {
    // Previously every unregistered en-* locale prefix-matched to en-US and
    // silently inherited US date order. Labels still default (we have no
    // basis for inventing a tax name), but the date order must be honest.
    expect(resolveLocaleProfile('en-IE').dateFormat).toBe('dmy');
    expect(resolveLocaleProfile('en-ZA').dateFormat).toBe('ymd');
    expect(resolveLocaleProfile('en-IN').dateFormat).toBe('dmy');
  });

  it('resolves date order for non-English locales too', () => {
    expect(resolveLocaleProfile('de-DE').dateFormat).toBe('dmy');
    expect(resolveLocaleProfile('ja-JP').dateFormat).toBe('ymd');
  });

  it('keeps default labels when only the date order could be resolved', () => {
    const profile = resolveLocaleProfile('en-IE');
    expect(profile.taxLabel).toBe(LOCALE_PROFILES['en-US'].taxLabel);
    expect(profile.currencySymbol).toBe(LOCALE_PROFILES['en-US'].currencySymbol);
  });

  it('falls back to the default date order when the tag is unusable', () => {
    expect(resolveLocaleProfile('').dateFormat).toBe('mdy');
    expect(resolveLocaleProfile('not a locale').dateFormat).toBe('mdy');
  });

  it('all 5 initial profiles have required fields (id, displayName, dateFormat, taxLabel, postalLabel, gcLabel, currencySymbol, thousandsSep, decimalSep)', () => {
    const requiredFields: (keyof LocaleProfile)[] = ['id', 'displayName', 'dateFormat', 'taxLabel', 'postalLabel', 'gcLabel', 'currencySymbol', 'thousandsSep', 'decimalSep'];
    
    const initialLocales = ['en-US', 'en-AU', 'en-GB', 'en-NZ', 'en-CA'];
    for (const locale of initialLocales) {
      const profile = LOCALE_PROFILES[locale];
      expect(profile).toBeDefined();
      for (const field of requiredFields) {
        expect(profile[field]).toBeDefined();
      }
    }
  });
  
  it('profile registry is extensible - adding en-NZ works without code changes', () => {
    LOCALE_PROFILES['test-NEW'] = {
      id: 'test-NEW',
      displayName: 'Test New',
      dateFormat: 'dmy',
      taxLabel: 'TAX',
      postalLabel: 'POST',
      gcLabel: 'GC',
      currencySymbol: '¤',
      thousandsSep: ',',
      decimalSep: '.'
    };
    
    expect(resolveLocaleProfile('test-NEW').id).toBe('test-NEW');
    
    delete LOCALE_PROFILES['test-NEW'];
  });
});

describe('locale profile content', () => {
  it("en-AU has dateFormat 'dmy', taxLabel 'GST', postalLabel 'Postcode'", () => {
    const profile = LOCALE_PROFILES['en-AU'];
    expect(profile.dateFormat).toBe('dmy');
    expect(profile.taxLabel).toBe('GST');
    expect(profile.postalLabel).toBe('Postcode');
  });
  
  it("en-US has dateFormat 'mdy', taxLabel 'Sales Tax', postalLabel 'Zip Code'", () => {
    const profile = LOCALE_PROFILES['en-US'];
    expect(profile.dateFormat).toBe('mdy');
    expect(profile.taxLabel).toBe('Sales Tax');
    expect(profile.postalLabel).toBe('Zip Code');
  });
  
  it("en-GB has dateFormat 'dmy', taxLabel 'VAT', postalLabel 'Postcode'", () => {
    const profile = LOCALE_PROFILES['en-GB'];
    expect(profile.dateFormat).toBe('dmy');
    expect(profile.taxLabel).toBe('VAT');
    expect(profile.postalLabel).toBe('Postcode');
  });
  
  it("en-CA has dateFormat 'ymd', taxLabel 'HST', postalLabel 'Postal Code'", () => {
    const profile = LOCALE_PROFILES['en-CA'];
    expect(profile.dateFormat).toBe('ymd');
    expect(profile.taxLabel).toBe('HST');
    expect(profile.postalLabel).toBe('Postal Code');
  });
  
  it("en-NZ has dateFormat 'dmy', taxLabel 'GST'", () => {
    const profile = LOCALE_PROFILES['en-NZ'];
    expect(profile.dateFormat).toBe('dmy');
    expect(profile.taxLabel).toBe('GST');
  });
});
