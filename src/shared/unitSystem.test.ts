import { describe, it, expect } from 'vitest';
import {
  METERS_PER_FOOT, MM_PER_INCH, SQUARE_METERS_PER_SF, SQUARE_METERS_PER_SY,
  CUBIC_METERS_PER_CY,
  parseUnitSystem, unitLabel, convertQty, fromDisplay, toDisplay, roundTo,
  formatQty, formatPipeSize, formatDepthBand, bidLineQty, metricUnitPrice,
  type QuantityKind,
} from './unitSystem';

describe('parseUnitSystem', () => {
  it('accepts only the two known values, defaulting to imperial', () => {
    expect(parseUnitSystem('metric')).toBe('metric');
    expect(parseUnitSystem('imperial')).toBe('imperial');
    expect(parseUnitSystem(undefined)).toBe('imperial');
    expect(parseUnitSystem(null)).toBe('imperial');
    expect(parseUnitSystem('METRIC')).toBe('imperial');
    expect(parseUnitSystem(1)).toBe('imperial');
  });
});

describe('conversion factors', () => {
  it('uses the exact defined factors, with derived area/volume', () => {
    expect(METERS_PER_FOOT).toBe(0.3048);
    expect(MM_PER_INCH).toBe(25.4);
    expect(SQUARE_METERS_PER_SF).toBe(0.3048 * 0.3048);
    expect(SQUARE_METERS_PER_SY).toBe(9 * 0.3048 * 0.3048);
    expect(CUBIC_METERS_PER_CY).toBe(27 * 0.3048 ** 3);
    // 1 CY = 0.764554857984 m³ in exact decimal arithmetic; float64 agrees
    // to within an ulp (~1 part in 10^16), far below physical meaning
    expect(CUBIC_METERS_PER_CY).toBeCloseTo(0.764554857984, 15);
  });
});

describe('convertQty / fromDisplay', () => {
  it('is the identity in imperial', () => {
    expect(convertQty(37.04, 'cy', 'imperial')).toBe(37.04);
    expect(fromDisplay(37.04, 'cy', 'imperial')).toBe(37.04);
  });

  it('converts every kind with its own factor', () => {
    expect(convertQty(1, 'ft', 'metric')).toBe(0.3048);
    expect(convertQty(1, 'lf', 'metric')).toBe(0.3048);
    expect(convertQty(1, 'in', 'metric')).toBe(25.4);
    expect(convertQty(1, 'sf', 'metric')).toBe(0.3048 * 0.3048);
    expect(convertQty(1, 'sfca', 'metric')).toBe(0.3048 * 0.3048);
    expect(convertQty(1, 'sy', 'metric')).toBeCloseTo(0.83612736, 15);
    expect(convertQty(1, 'cy', 'metric')).toBeCloseTo(0.764554857984, 15);
  });

  it('inverts convertQty', () => {
    const kinds: QuantityKind[] = ['ft', 'lf', 'in', 'sf', 'sfca', 'sy', 'cy'];
    for (const kind of kinds) {
      expect(fromDisplay(convertQty(12.5, kind, 'metric'), kind, 'metric')).toBeCloseTo(12.5, 12);
    }
  });
});

describe('toDisplay round-trip (metric fidelity)', () => {
  it('gives a metric user back exactly what they typed', () => {
    // 0.9 m stored as feet must render as exactly 0.9, not 0.9000000000000001
    const typedValues = [0.9, 1.2, 0.05, 25, 150, 4.5, 0.3];
    for (const typed of typedValues) {
      const canonical = fromDisplay(typed, 'ft', 'metric');
      expect(toDisplay(canonical, 'ft', 'metric')).toBe(typed);
    }
    // mm too: a 100 mm thickness stays 100 mm
    const canonicalIn = fromDisplay(100, 'in', 'metric');
    expect(toDisplay(canonicalIn, 'in', 'metric')).toBe(100);
  });

  it('leaves imperial values untouched apart from noise rounding', () => {
    expect(toDisplay(4, 'ft', 'imperial')).toBe(4);
    expect(toDisplay(0.5, 'ft', 'imperial')).toBe(0.5);
  });
});

describe('roundTo', () => {
  it('rounds to the requested decimals without trailing-zero formatting', () => {
    expect(roundTo(1.524, 1)).toBe(1.5);
    expect(roundTo(4.572, 1)).toBe(4.6);
    expect(roundTo(6.096, 1)).toBe(6.1);
    expect(roundTo(5, 0)).toBe(5);
  });
});

describe('unitLabel / formatQty', () => {
  it('labels each kind per system', () => {
    expect(unitLabel('ft', 'imperial')).toBe('ft');
    expect(unitLabel('ft', 'metric')).toBe('m');
    expect(unitLabel('lf', 'imperial')).toBe('LF');
    expect(unitLabel('lf', 'metric')).toBe('m');
    expect(unitLabel('in', 'metric')).toBe('mm');
    expect(unitLabel('sf', 'metric')).toBe('m²');
    expect(unitLabel('sfca', 'imperial')).toBe('SFCA');
    expect(unitLabel('sfca', 'metric')).toBe('m²');
    expect(unitLabel('sy', 'imperial')).toBe('SY');
    expect(unitLabel('sy', 'metric')).toBe('m²');
    expect(unitLabel('cy', 'imperial')).toBe('CY');
    expect(unitLabel('cy', 'metric')).toBe('m³');
  });

  it('formats converted, rounded, labelled strings', () => {
    expect(formatQty(37.04, 'cy', 'imperial', 2)).toBe('37.04 CY');
    expect(formatQty(37.04, 'cy', 'metric', 2)).toBe('28.32 m³');
    expect(formatQty(100, 'lf', 'metric', 1)).toBe('30.5 m');
    expect(formatQty(1000, 'sf', 'metric', 0)).toBe('93 m²');
  });
});

describe('bidLineQty (engine emissions, #97 phase 3)', () => {
  it('passes imperial through untouched, keeping the caller unit spelling', () => {
    expect(bidLineQty(37.04, 'cy', 'imperial')).toEqual({ quantity: 37.04, unit: 'CY' });
    expect(bidLineQty(37.04, 'cy', 'imperial', 'CYD')).toEqual({ quantity: 37.04, unit: 'CYD' });
    expect(bidLineQty(1250, 'lf', 'imperial')).toEqual({ quantity: 1250, unit: 'LF' });
  });

  it('converts and rounds to 2 decimals in metric, with the metric unit', () => {
    expect(bidLineQty(100, 'lf', 'metric')).toEqual({ quantity: 30.48, unit: 'm' });
    expect(bidLineQty(37.04, 'cy', 'metric')).toEqual({ quantity: 28.32, unit: 'm³' });
    expect(bidLineQty(120, 'sy', 'metric')).toEqual({ quantity: 100.34, unit: 'm²' });
    // the imperial spelling is irrelevant once metric
    expect(bidLineQty(10, 'cy', 'metric', 'CYD').unit).toBe('m³');
  });
});

describe('metricUnitPrice (engine emissions, #97 phase 3)', () => {
  it('converts a per-imperial-unit price to an exact per-metric-unit price', () => {
    expect(metricUnitPrice(100, 'cy')).toBe(130.8);   // $/CY → $/m³
    expect(metricUnitPrice(10, 'lf')).toBe(32.81);    // $/LF → $/m
    expect(metricUnitPrice(9, 'sy')).toBe(10.76);     // $/SY → $/m²
  });

  it('preserves the extended total (qty × price) across the conversion', () => {
    // 100 LF @ $10/LF = $1000 ↔ 30.48 m @ $32.81/m, off only by cents rounding
    const metricQty = bidLineQty(100, 'lf', 'metric').quantity;
    expect(metricQty * metricUnitPrice(10, 'lf')).toBeCloseTo(1000, 0);
  });
});

describe('formatPipeSize', () => {
  it('renders inches imperial, DN designations metric', () => {
    expect(formatPipeSize(8, 'imperial')).toBe('8"');
    expect(formatPipeSize(8, 'metric')).toBe('DN200');
    expect(formatPipeSize(12, 'metric')).toBe('DN300');
    expect(formatPipeSize(15, 'metric')).toBe('DN375');
    expect(formatPipeSize(0.75, 'metric')).toBe('DN20');
    expect(formatPipeSize(48, 'metric')).toBe('DN1200');
  });

  it('falls back to true millimetres for non-standard sizes', () => {
    // 7" has no DN designation; never show inches to a metric user
    expect(formatPipeSize(7, 'metric')).toBe('178 mm');
  });
});

describe('formatDepthBand', () => {
  it('matches the trenchCalc imperial band labels', () => {
    expect(formatDepthBand(0, 5, 'imperial')).toBe('0–5 ft');
    expect(formatDepthBand(5, 10, 'imperial')).toBe('5–10 ft');
    expect(formatDepthBand(20, Infinity, 'imperial')).toBe('20+ ft');
  });

  it('converts band bounds to metres at one decimal', () => {
    expect(formatDepthBand(0, 5, 'metric')).toBe('0–1.5 m');
    expect(formatDepthBand(5, 10, 'metric')).toBe('1.5–3 m');
    expect(formatDepthBand(10, 15, 'metric')).toBe('3–4.6 m');
    expect(formatDepthBand(20, Infinity, 'metric')).toBe('6.1+ m');
  });
});
