import { describe, expect, it } from 'vitest';
import { parseNumericInput } from './parseNumericInput';

describe('parseNumericInput', () => {
  it('parses a formatted thousands value instead of truncating at the comma', () => {
    // The bug this guards: parseFloat("1,250") === 1, which then passed a
    // Number.isFinite check and committed a corrupted bid quantity.
    expect(parseNumericInput('1,250')).toBe(1250);
    expect(parseNumericInput('1,250.50')).toBe(1250.5);
    expect(parseNumericInput('1,000,000')).toBe(1000000);
  });

  it('parses plain numbers', () => {
    expect(parseNumericInput('0')).toBe(0);
    expect(parseNumericInput('42')).toBe(42);
    expect(parseNumericInput('3.14')).toBe(3.14);
    expect(parseNumericInput('.5')).toBe(0.5);
    expect(parseNumericInput('  12  ')).toBe(12);
  });

  it('parses negatives (deduct/credit lines)', () => {
    expect(parseNumericInput('-5')).toBe(-5);
    expect(parseNumericInput('-1,250.5')).toBe(-1250.5);
  });

  it('rejects garbage instead of silently truncating like parseFloat', () => {
    expect(parseNumericInput('12abc')).toBeNaN();
    expect(parseNumericInput('abc')).toBeNaN();
    expect(parseNumericInput('1.2.3')).toBeNaN();
    expect(parseNumericInput('')).toBeNaN();
    expect(parseNumericInput('   ')).toBeNaN();
    expect(parseNumericInput('-')).toBeNaN();
    expect(parseNumericInput('.')).toBeNaN();
    expect(parseNumericInput(undefined as any)).toBeNaN();
  });

  it('keeps a trailing dot usable mid-typing (matches old parseFloat)', () => {
    // Typing "1.5" passes through "1." — that intermediate should read as 1,
    // not flip a computed total to 0 for a keystroke.
    expect(parseNumericInput('1.')).toBe(1);
  });
});
