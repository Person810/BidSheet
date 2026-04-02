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
