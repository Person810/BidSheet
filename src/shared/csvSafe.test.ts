import { describe, expect, it } from 'vitest';
import { neutralizeCsvFormula } from './csvSafe';

describe('neutralizeCsvFormula', () => {
  it('quotes values that begin with a formula trigger', () => {
    expect(neutralizeCsvFormula('=1+1')).toBe("'=1+1");
    expect(neutralizeCsvFormula('=HYPERLINK("http://evil")')).toBe('\'=HYPERLINK("http://evil")');
    expect(neutralizeCsvFormula('@SUM(A1:A9)')).toBe("'@SUM(A1:A9)");
    expect(neutralizeCsvFormula('+1+1')).toBe("'+1+1");
    expect(neutralizeCsvFormula('-1+cmd|/c calc')).toBe("'-1+cmd|/c calc");
    expect(neutralizeCsvFormula('\tleading tab')).toBe("'\tleading tab");
  });

  it('leaves genuine numbers untouched so numeric columns still import', () => {
    expect(neutralizeCsvFormula('-5.00')).toBe('-5.00'); // a real discount
    expect(neutralizeCsvFormula('-12')).toBe('-12');
    expect(neutralizeCsvFormula('+3.5')).toBe('+3.5');
    expect(neutralizeCsvFormula('1.5e3')).toBe('1.5e3');
    expect(neutralizeCsvFormula('0')).toBe('0');
  });

  it('leaves ordinary text untouched', () => {
    expect(neutralizeCsvFormula('8" PVC SDR-35')).toBe('8" PVC SDR-35');
    expect(neutralizeCsvFormula('ACME GC')).toBe('ACME GC');
    expect(neutralizeCsvFormula('')).toBe('');
  });
});
