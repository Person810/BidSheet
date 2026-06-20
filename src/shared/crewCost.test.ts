import { describe, expect, it } from 'vitest';
import { calcCrewCostPerHour, explainCrewCost } from './crewCost';

const member = (quantity: number, rate: number, burden: number, role_name?: string) => ({
  quantity,
  default_hourly_rate: rate,
  burden_multiplier: burden,
  ...(role_name ? { role_name } : {}),
});

describe('calcCrewCostPerHour', () => {
  it('is zero for a crew with no members', () => {
    expect(calcCrewCostPerHour({ members: [] })).toBe(0);
  });

  it('is zero when members is missing entirely', () => {
    expect(calcCrewCostPerHour({})).toBe(0);
  });

  it('burdens a single member: count × rate × burden', () => {
    // 2 operators × $50/hr × 1.5 burden = $150/hr
    expect(calcCrewCostPerHour({ members: [member(2, 50, 1.5)] })).toBe(150);
  });

  it('sums burdened cost across multiple roles', () => {
    // 1×40×1.25 = 50, 2×30×1.4 = 84  →  134
    const cost = calcCrewCostPerHour({ members: [member(1, 40, 1.25), member(2, 30, 1.4)] });
    expect(cost).toBeCloseTo(134, 10);
  });

  it('treats a burden multiplier of 1 as the raw wage', () => {
    expect(calcCrewCostPerHour({ members: [member(3, 25, 1)] })).toBe(75);
  });
});

describe('explainCrewCost', () => {
  it('emits one term line per member plus a result line equal to the total', () => {
    const crew = { members: [member(1, 40, 1.25, 'Operator'), member(2, 30, 1.4, 'Laborer')] };
    const breakdown = explainCrewCost(crew);

    const terms = breakdown.lines.filter((l) => l.kind === 'term');
    const results = breakdown.lines.filter((l) => l.kind === 'result');
    expect(terms).toHaveLength(2);
    expect(results).toHaveLength(1);
    expect(terms[0].label).toBe('1× Operator');
    expect(terms[1].label).toBe('2× Laborer');
  });

  it('labels a member with no role name generically', () => {
    const breakdown = explainCrewCost({ members: [member(1, 40, 1.25)] });
    expect(breakdown.lines[0].label).toBe('1× crew member');
  });

  it('notes when there are no crew members', () => {
    const breakdown = explainCrewCost({ members: [] });
    expect(breakdown.note).toMatch(/No crew members/);
    // Only the result line is present.
    expect(breakdown.lines).toHaveLength(1);
    expect(breakdown.lines[0].kind).toBe('result');
  });
});
