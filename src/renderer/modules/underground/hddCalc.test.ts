import { describe, it, expect } from 'vitest';
import { calculateHDD } from './hddCalc';

describe('HDD Calculator', () => {
  describe('Metric (en-AU)', () => {
    it('calculates a metro 90mm bore run of 100m with no slurry and no pits', () => {
      const res = calculateHDD({
        location: 'metro',
        dn: 90,
        length: 100,
        includeSlurry: false,
        includePits: false,
        marginPct: 15,
        locale: 'en-AU',
      });

      expect(res.summary.durationDays).toBe(2);
      expect(res.summary.crewSize).toBe(3);
      expect(res.breakdown.establishment).toBe(8050);
      expect(res.breakdown.slurryDisposal).toBe(0);
      expect(res.breakdown.excavatorAllowance).toBe(0);
    });

    it('calculates with slurry and pits enabled', () => {
      const res = calculateHDD({
        location: 'metro',
        dn: 90,
        length: 100,
        includeSlurry: true,
        includePits: true,
        marginPct: 15,
        locale: 'en-AU',
      });

      expect(res.breakdown.slurryDisposal).toBeGreaterThan(0);
      expect(res.breakdown.excavatorAllowance).toBeGreaterThan(0);
    });

    it('divides excavator allowance by boresPerPit', () => {
      const res1 = calculateHDD({
        location: 'metro',
        dn: 90,
        length: 100,
        includePits: true,
        locale: 'en-AU',
        boresPerPit: 1,
      });
      const res3 = calculateHDD({
        location: 'metro',
        dn: 90,
        length: 100,
        includePits: true,
        locale: 'en-AU',
        boresPerPit: 3,
      });
      expect(res3.breakdown.excavatorAllowance).toBe(Math.round(res1.breakdown.excavatorAllowance / 3));
    });

    it('returns zero for all costs when isBundle is true', () => {
      const res = calculateHDD({
        location: 'metro',
        dn: 90,
        length: 100,
        locale: 'en-AU',
        isBundle: true,
      });
      expect(res.summary.totalEstimate).toBe(0);
      expect(res.breakdown.establishment).toBe(0);
      expect(res.breakdown.crewAndRigSpread).toBe(0);
    });

    it('calculates subsequent bores with drilling time and fluids but no setup costs', () => {
      const baseRes = calculateHDD({
        location: 'metro',
        dn: 90,
        length: 100,
        includePits: true,
        locale: 'en-AU',
        boresPerPit: 1,
      });

      const multiRes = calculateHDD({
        location: 'metro',
        dn: 90,
        length: 100,
        includePits: true,
        locale: 'en-AU',
        boresPerPit: 1,
        additionalPipes: [
          { pipeSizeIn: 90, pipeMaterialId: 1 },
          { pipeSizeIn: 63, pipeMaterialId: 2 }
        ]
      });

      // Establishment cost should match base exactly (no setup costs for sub-bores)
      expect(multiRes.breakdown.establishment).toBe(baseRes.breakdown.establishment);
      
      // Excavator allowance should match base (no setup costs for sub-bores)
      expect(multiRes.breakdown.excavatorAllowance).toBe(baseRes.breakdown.excavatorAllowance);

      // Duration should be sum of days (2 days for main + 2 days for second + 2 days for third)
      expect(multiRes.summary.durationDays).toBeGreaterThan(baseRes.summary.durationDays);

      // Crew and rig spread should be higher
      expect(multiRes.breakdown.crewAndRigSpread).toBeGreaterThan(baseRes.breakdown.crewAndRigSpread);

      // Fluids should be higher
      expect(multiRes.breakdown.drillingFluids).toBeGreaterThan(baseRes.breakdown.drillingFluids);
    });
  });

  describe('Imperial (en-US)', () => {
    it('calculates a metro 4" bore run of 330 ft with no slurry and no pits', () => {
      const res = calculateHDD({
        location: 'metro',
        dn: 4,
        length: 330,
        includeSlurry: false,
        includePits: false,
        marginPct: 15,
        locale: 'en-US',
      });

      expect(res.summary.durationDays).toBe(3); // 330 ft / 160 ft/day = 2.06 -> ceil = 3 days
      expect(res.summary.crewSize).toBe(4); // 4" matches the 6" bracket -> 4 crew

      expect(res.breakdown.slurryDisposal).toBe(0);
      expect(res.breakdown.excavatorAllowance).toBe(0);
    });
  });
});
