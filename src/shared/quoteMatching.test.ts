import { describe, it, expect } from 'vitest';
import {
  normalizeDescription,
  normalizeTokens,
  similarity,
  buildAliasIndex,
  aliasKey,
  matchQuoteRow,
  unitsMismatch,
  type MatchCandidate,
} from './quoteMatching';

describe('normalizeDescription', () => {
  it('lowercases and expands trade abbreviations', () => {
    expect(normalizeDescription('8" DIP CL52 MJ')).toBe(
      '8 in ductile iron pipe class 52 mechanical joint',
    );
  });

  it('treats inch mark, "in" and "inch" the same', () => {
    expect(normalizeTokens('12" PVC')).toEqual(normalizeTokens('12 inch pvc'));
    expect(normalizeTokens('12 in. PVC')).toEqual(normalizeTokens('12" PVC'));
  });

  it('strips punctuation to bare tokens', () => {
    expect(normalizeDescription('8-in., SDR-35')).toBe('8 in sdr 35');
  });
});

describe('similarity', () => {
  it('is 1 for identical token sets', () => {
    const t = normalizeTokens('8" PVC SDR-35');
    expect(similarity(t, t)).toBe(1);
  });

  it('rewards shared size numbers over filler words', () => {
    const a = normalizeTokens('8" PVC SDR-35 gravity sewer pipe');
    const same = normalizeTokens('8 inch pvc sdr 35');
    const diffSize = normalizeTokens('12 inch pvc sdr 35');
    expect(similarity(a, same)).toBeGreaterThan(similarity(a, diffSize));
  });

  it('is 0 against an empty set', () => {
    expect(similarity(normalizeTokens('anything'), [])).toBe(0);
  });
});

describe('unitsMismatch', () => {
  it('flags genuinely different units', () => {
    expect(unitsMismatch('per-100-ft', 'LF')).toBe(true);
    expect(unitsMismatch('EA', 'LF')).toBe(true);
  });

  it('does not flag equivalent or missing units', () => {
    expect(unitsMismatch('CY', 'CYD')).toBe(false);
    expect(unitsMismatch('ea', 'EA')).toBe(false);
    expect(unitsMismatch(null, 'LF')).toBe(false);
    expect(unitsMismatch('LF', '')).toBe(false);
  });
});

describe('matchQuoteRow', () => {
  const candidates: MatchCandidate[] = [
    { lineId: 1, description: '8" PVC SDR-35 sewer', unit: 'LF', materialId: 10,
      materialName: '8" PVC SDR-35', materialAliases: 'gravity sewer', materialPartNumber: 'PVC0835' },
    { lineId: 2, description: '12" PVC SDR-35 sewer', unit: 'LF', materialId: 11,
      materialName: '12" PVC SDR-35', materialAliases: null, materialPartNumber: null },
    { lineId: 3, description: '4" DI gate valve', unit: 'EA', materialId: 12,
      materialName: '4" DI Gate Valve', materialAliases: null, materialPartNumber: 'GV-4DI' },
  ];

  it('auto-matches a confident fuzzy winner', () => {
    const res = matchQuoteRow(
      { description: '8 inch pvc sdr 35 gravity sewer', unit: 'LF' },
      'Core & Main', candidates, new Map(),
    );
    expect(res.status).toBe('matched');
    expect(res.method).toBe('fuzzy');
    expect(res.suggestedLineId).toBe(1);
  });

  it('prefers an exact learned alias over fuzzy', () => {
    const index = buildAliasIndex([
      { supplier: 'Core & Main', rawDescription: normalizeDescription('8in SDR35'), materialId: 11 },
    ]);
    const res = matchQuoteRow(
      { description: '8in SDR35', unit: 'LF' }, 'core & main', candidates, index,
    );
    expect(res.status).toBe('matched');
    expect(res.method).toBe('alias');
    expect(res.suggestedLineId).toBe(2); // material 11 → line 2, not the fuzzy size-8 line
  });

  it('matches on part number when present', () => {
    const res = matchQuoteRow(
      { description: 'four inch valve assembly', unit: 'EA', partNumber: 'GV-4DI' },
      'Ferguson', candidates, new Map(),
    );
    expect(res.status).toBe('matched');
    expect(res.method).toBe('part_number');
    expect(res.suggestedLineId).toBe(3);
  });

  it('returns unmatched for nonsense', () => {
    const res = matchQuoteRow(
      { description: 'concrete washout porta potty rental', unit: 'EA' },
      'Acme', candidates, new Map(),
    );
    expect(res.status).toBe('unmatched');
    expect(res.suggestedLineId).toBeNull();
  });

  it('surfaces the alias material even when no line uses it', () => {
    const index = buildAliasIndex([
      { supplier: 'Core & Main', rawDescription: normalizeDescription('mystery part'), materialId: 999 },
    ]);
    const res = matchQuoteRow(
      { description: 'mystery part', unit: 'EA' }, 'Core & Main', candidates, index,
    );
    expect(res.aliasMaterialId).toBe(999);
  });

  it('builds a supplier-scoped alias key', () => {
    expect(aliasKey('Core & Main', 'x')).toBe('core & main x');
  });
});
