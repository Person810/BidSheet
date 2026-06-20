import { describe, expect, it } from 'vitest';
import { roundHours } from './round';

describe('roundHours', () => {
  it('keeps small priced hours instead of collapsing them to zero', () => {
    // 4 EA at 100 EA/hr = 0.04 hr. One-decimal rounding would make this 0 and
    // silently zero the labor cost; four decimals keeps it.
    expect(roundHours(4 / 100)).toBe(0.04);
    expect(roundHours(4 / 100)).toBeGreaterThan(0);
  });

  it('preserves fractional hours that one-decimal rounding would distort', () => {
    // 500 LF at 1500 LF/hr = 0.3333… hr. One-decimal rounding (0.3) understates
    // labor by ~10%; four decimals stays accurate.
    expect(roundHours(500 / 1500)).toBe(0.3333);
  });

  it('rounds to four decimals', () => {
    expect(roundHours(1.234567)).toBe(1.2346);
    expect(roundHours(2)).toBe(2);
  });
});
