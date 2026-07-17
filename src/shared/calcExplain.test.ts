import { describe, it, expect } from 'vitest';
import {
  fmtMoney, fmtNum, fmtQty, explainProduct, explainQuotient, explainSum, explainPercentOf,
} from './calcExplain';
import { explainCrewCost, calcCrewCostPerHour } from './crewCost';
import { explainDirectCost, explainMarkup, explainGrandTotal, type FullBidSummary } from './bidCalc';

describe('formatters', () => {
  it('formats money and numbers', () => {
    expect(fmtMoney(1250)).toBe('$1,250.00');
    expect(fmtNum(14.73, 1)).toBe('14.7');
    expect(fmtQty(1250, 'LF', 0)).toBe('1,250 LF');
  });
});

describe('generic builders', () => {
  it('product/quotient mark the result line', () => {
    const p = explainProduct('a × b', { label: 'a', value: '2' }, { label: 'b', value: '3' }, { label: 'r', value: '6' });
    expect(p.lines.at(-1)).toMatchObject({ kind: 'result', value: '6' });
    const q = explainQuotient('a ÷ b', { label: 'a', value: '6' }, { label: 'b', value: '3' }, { label: 'r', value: '2' });
    expect(q.lines).toHaveLength(3);
  });

  it('sum lists every part plus the result', () => {
    const s = explainSum('sum', [{ label: 'x', value: '1' }, { label: 'y', value: '2' }], { label: 't', value: '3' });
    expect(s.lines.filter((l) => l.kind === 'term')).toHaveLength(2);
  });

  it('percent-of derives a blended rate from base and result', () => {
    const b = explainPercentOf('Overhead', 'Direct cost', 1000, 125);
    // 125 / 1000 = 12.5%
    expect(b.lines.find((l) => l.label === 'Rate')?.value).toBe('12.5%');
    expect(b.lines.at(-1)).toMatchObject({ kind: 'result', value: '$125.00' });
  });
});

describe('explainCrewCost', () => {
  it('breaks down each member and totals to calcCrewCostPerHour', () => {
    const crew = { members: [
      { quantity: 1, default_hourly_rate: 45, burden_multiplier: 1.5, role_name: 'Operator' },
      { quantity: 2, default_hourly_rate: 28, burden_multiplier: 1.4, role_name: 'Laborer' },
    ] };
    const bd = explainCrewCost(crew);
    expect(bd.lines).toHaveLength(3); // 2 members + result
    expect(bd.lines[0].label).toBe('1× Operator');
    expect(bd.lines.at(-1)?.value).toBe(fmtMoney(calcCrewCostPerHour(crew)));
  });
});

describe('bidCalc explainers', () => {
  const s: FullBidSummary = {
    material_total: 10000, labor_total: 5000, equipment_total: 2000, subcontractor_total: 1000,
    direct_cost_total: 18000, escalation: 0, indirect_total: 0, overhead: 1800, profit: 1800, bond: 0, tax: 800,
    grandTotal: 24200, alternates: [],
  };

  it('direct cost sums the four cost buckets', () => {
    const bd = explainDirectCost(s);
    expect(bd.lines.at(-1)).toMatchObject({ value: '$18,000.00', kind: 'result' });
  });

  it('overhead uses (direct cost + escalation) as the base', () => {
    const bd = explainMarkup('overhead', s, false);
    expect(bd.lines.find((l) => l.label === 'Direct cost + escalation')?.value).toBe('$18,000.00');
    expect(bd.lines.find((l) => l.label === 'Rate')?.value).toBe('10%');
  });

  it('tax uses (material + escalation) as the base', () => {
    const bd = explainMarkup('tax', s, false);
    expect(bd.lines.find((l) => l.label === 'Material + escalation')?.value).toBe('$10,000.00');
  });

  it('notes a blended rate when sections override markups', () => {
    expect(explainMarkup('overhead', s, true).note).toMatch(/blended/i);
    expect(explainMarkup('overhead', s, false).note).toBeUndefined();
  });

  it('grand total sums direct cost, escalation, and markups', () => {
    expect(explainGrandTotal(s).lines.at(-1)?.value).toBe('$24,200.00');
  });
});
