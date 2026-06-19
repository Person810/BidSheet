import type { CalcBreakdown } from './calcExplain';
import { fmtMoney, fmtNum } from './calcExplain';

/**
 * Calculate the fully-burdened cost per hour for a crew template.
 * Used by LineItemModal, FuzzyAutocomplete, and anywhere crew cost is needed.
 */
export function calcCrewCostPerHour(crew: { members?: { quantity: number; default_hourly_rate: number; burden_multiplier: number }[] }): number {
  return (crew.members || []).reduce(
    (sum, m) => sum + m.quantity * m.default_hourly_rate * m.burden_multiplier,
    0,
  );
}

/** "Show the math" for a crew's burdened cost/hour: Σ (count × rate × burden). */
export function explainCrewCost(
  crew: { members?: { quantity: number; default_hourly_rate: number; burden_multiplier: number; role_name?: string }[] },
): CalcBreakdown {
  const members = crew.members || [];
  return {
    formula: 'Crew cost/hr = Σ (count × hourly rate × burden)',
    lines: [
      ...members.map((m) => ({
        label: `${m.quantity}× ${m.role_name || 'crew member'}`,
        value: `${m.quantity} × ${fmtMoney(m.default_hourly_rate)} × ${fmtNum(m.burden_multiplier, 2)} = ${fmtMoney(m.quantity * m.default_hourly_rate * m.burden_multiplier)}`,
        kind: 'term' as const,
      })),
      { label: 'Crew cost/hr', value: fmtMoney(calcCrewCostPerHour(crew)), kind: 'result' as const },
    ],
    note: members.length === 0 ? 'No crew members configured.' : 'Burden covers taxes, insurance, and overhead on the base wage.',
  };
}

