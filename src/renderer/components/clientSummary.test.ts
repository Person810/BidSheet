import { describe, it, expect } from 'vitest';
import { clientSummaryParts, type ClientSummarySource } from './clientSummary';

function client(over: Partial<ClientSummarySource> = {}): ClientSummarySource {
  return {
    contact_name: 'Dana Reyes',
    contact_phone: '555-0142',
    contact_email: 'dana@example.com',
    address: '3 Testing Road',
    ...over,
  };
}

describe('clientSummaryParts', () => {
  it('orders a fully filled-in client contact-first', () => {
    expect(clientSummaryParts(client())).toEqual([
      'Dana Reyes',
      '555-0142',
      'dana@example.com',
      '3 Testing Road',
    ]);
  });

  it('drops blank and whitespace-only fields instead of leaving gaps', () => {
    expect(
      clientSummaryParts(client({ contact_name: null, contact_email: '   ' }))
    ).toEqual(['555-0142', '3 Testing Road']);
  });

  it('trims stored values', () => {
    expect(clientSummaryParts(client({ contact_phone: '  555-0142  ' }))).toContain(
      '555-0142'
    );
  });

  it('returns nothing for a client with no details, or no client at all', () => {
    const bare = client({
      contact_name: null,
      contact_phone: null,
      contact_email: null,
      address: null,
    });
    expect(clientSummaryParts(bare)).toEqual([]);
    expect(clientSummaryParts(null)).toEqual([]);
    expect(clientSummaryParts(undefined)).toEqual([]);
  });
});
