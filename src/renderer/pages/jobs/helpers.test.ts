import { describe, expect, it } from 'vitest';
import { parseImportQuantity, jobToPayload } from './helpers';

describe('jobToPayload', () => {
  // db:jobs:save binds every job column on update, so a field missing from
  // this payload is written as NULL. Partial saves (status change, bid-lock
  // toggle) spread it, which is how site_postcode/site_country got wiped.
  const row = {
    id: 7, name: 'Canal St Sewer', job_number: '24-018', client: 'Boh Bros',
    location: '1400 Canal St', site_postcode: '70112', site_country: 'United States',
    bid_date: '2026-08-01', start_date: null, description: null, status: 'draft',
    overhead_percent: 10, profit_percent: 10, bond_percent: 1, tax_percent: 9.45,
    escalation_percent: 0, notes: null, bid_locked: 0, parent_job_id: null,
    change_order_number: null, freight: 250,
  };

  it('round-trips the site fields so a partial save cannot blank them', () => {
    const payload = jobToPayload(row);
    expect(payload.sitePostcode).toBe('70112');
    expect(payload.siteCountry).toBe('United States');
    expect(payload.freight).toBe(250);
  });

  it('carries every column db:jobs:save writes on update', () => {
    // Guards against the next column being added to the UPDATE without
    // being added here — the failure mode is silent data loss, not an error.
    const payload = jobToPayload(row);
    for (const key of [
      'name', 'jobNumber', 'client', 'location', 'sitePostcode', 'siteCountry',
      'bidDate', 'startDate', 'description', 'status', 'overheadPercent',
      'profitPercent', 'bondPercent', 'taxPercent', 'escalationPercent',
      'notes', 'bidLocked', 'freight',
    ]) {
      expect(payload, `missing ${key}`).toHaveProperty(key);
    }
  });

  it('maps absent site fields to null rather than undefined', () => {
    const payload = jobToPayload({ ...row, site_postcode: null, site_country: undefined });
    expect(payload.sitePostcode).toBeNull();
    expect(payload.siteCountry).toBeNull();
  });
});

describe('parseImportQuantity', () => {
  it('parses plain and decimal numbers', () => {
    expect(parseImportQuantity('1250')).toBe(1250);
    expect(parseImportQuantity('12.5')).toBe(12.5);
  });

  it('strips thousands separators', () => {
    expect(parseImportQuantity('1,250')).toBe(1250);
    expect(parseImportQuantity('12,345.75')).toBe(12345.75);
  });

  it('ignores trailing units and surrounding text', () => {
    expect(parseImportQuantity('1,250 LF')).toBe(1250);
    expect(parseImportQuantity('approx. 40 EA')).toBe(40);
  });

  it('returns 0 for blanks, junk, and negatives', () => {
    expect(parseImportQuantity('')).toBe(0);
    expect(parseImportQuantity(null)).toBe(0);
    expect(parseImportQuantity('LS')).toBe(0);
    expect(parseImportQuantity('-50')).toBe(0);
  });
});
