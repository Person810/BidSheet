import { describe, it, expect } from 'vitest';
import { clientSiteDefaults, type JobSiteDraft } from './clientJobDraft';
import { LOCALE_PROFILES } from '../../../shared/localeProfiles';

const US = LOCALE_PROFILES['en-US'];
const AU = LOCALE_PROFILES['en-AU'];

const empty: JobSiteDraft = { location: '', sitePostcode: '', siteCountry: '' };
const filled: JobSiteDraft = {
  location: '1400 Canal St, Trench 4',
  sitePostcode: '70112',
  siteCountry: 'United States',
};

describe('clientSiteDefaults', () => {
  it('fills a blank location with the client address', () => {
    const result = clientSiteDefaults(empty, { address: '55 Office Park Dr' }, US);
    expect(result.location).toBe('55 Office Park Dr');
  });

  it('never overwrites a location the estimator already entered', () => {
    const result = clientSiteDefaults(filled, { address: '55 Office Park Dr' }, US);
    expect(result).toEqual(filled);
  });

  it('leaves the draft untouched when the client has no address', () => {
    expect(clientSiteDefaults(filled, { address: null }, US)).toEqual(filled);
    expect(clientSiteDefaults(empty, { address: '   ' }, US)).toEqual(empty);
  });

  it('does not touch postcode or country outside en-AU', () => {
    const result = clientSiteDefaults(empty, { address: '55 Office Park Dr' }, US);
    expect(result.sitePostcode).toBe('');
    expect(result.siteCountry).toBe('');
  });

  it('splits an AU address into location + postcode when the draft is blank', () => {
    const result = clientSiteDefaults(
      empty,
      { address: '12 Wattle St\nRICHMOND VIC 3121' },
      AU,
    );
    expect(result.location).toBe('12 Wattle St\nRICHMOND VIC 3121');
    expect(result.sitePostcode).toBe('3121');
    expect(result.siteCountry).toBe('Australia');
  });

  it('preserves an existing AU site address instead of clobbering it', () => {
    const site: JobSiteDraft = {
      location: 'Lot 7 Kembla Rd\nWOLLONGONG NSW 2500',
      sitePostcode: '2500',
      siteCountry: 'Australia',
    };
    const result = clientSiteDefaults(
      site,
      { address: '12 Wattle St\nRICHMOND VIC 3121' },
      AU,
    );
    expect(result).toEqual(site);
  });

  it('fills only the blank fields in a partially-entered AU draft', () => {
    const result = clientSiteDefaults(
      { location: 'Lot 7 Kembla Rd', sitePostcode: '', siteCountry: '' },
      { address: '12 Wattle St\nRICHMOND VIC 3121' },
      AU,
    );
    expect(result.location).toBe('Lot 7 Kembla Rd');
    expect(result.sitePostcode).toBe('3121');
    expect(result.siteCountry).toBe('Australia');
  });
});
