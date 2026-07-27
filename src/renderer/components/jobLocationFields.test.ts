import { describe, expect, it } from 'vitest';
import { parseJobLocation, formatJobLocation } from './JobLocationFields';

describe('JobLocationFields formatting and parsing helpers', () => {
  describe('parseJobLocation', () => {
    it('returns empty fields for empty or null location', () => {
      expect(parseJobLocation(null)).toEqual({ street: '', suburb: '', state: '' });
      expect(parseJobLocation('')).toEqual({ street: '', suburb: '', state: '' });
    });

    it('parses standard Australian single-line location format correctly', () => {
      const parsed = parseJobLocation('123 Main Street\nHEWETT SA 5118');
      expect(parsed).toEqual({
        street: '123 Main Street',
        suburb: 'HEWETT',
        state: 'SA',
      });
    });

    it('handles multiple street lines cleanly', () => {
      const parsed = parseJobLocation('Building 4\nSuite 10\n456 George St\nSYDNEY NSW 2000');
      expect(parsed).toEqual({
        street: 'Building 4\nSuite 10\n456 George St',
        suburb: 'SYDNEY',
        state: 'NSW',
      });
    });

    it('falls back to setting the entire address as street if parsing fails', () => {
      const parsed = parseJobLocation('123 Random Place, Somewhere');
      expect(parsed).toEqual({
        street: '123 Random Place, Somewhere',
        suburb: '',
        state: '',
      });
    });
  });

  describe('formatJobLocation', () => {
    it('combines inputs into standard Australian mailing block format', () => {
      const formatted = formatJobLocation('456 George St', 'Sydney', 'NSW', '2000');
      expect(formatted).toBe('456 George St\nSYDNEY NSW 2000');
    });

    it('omits empty fields gracefully', () => {
      const formatted = formatJobLocation('456 George St', '', '', '');
      expect(formatted).toBe('456 George St');
    });
  });
});
