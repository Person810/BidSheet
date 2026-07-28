import { describe, it, expect } from 'vitest';
import { laborHoursForQuantity } from './lineItemPayload';

/**
 * The rule the bid grid and the line-item modal must agree on. They didn't:
 * the modal recomputed hours from the production rate when quantity changed
 * and the grid's inline Qty cell did not, so the same edit priced differently
 * depending on where you made it.
 */
describe('laborHoursForQuantity', () => {
  const rate = { rate_per_hour: 25 };

  it('scales hours with quantity at the production rate', () => {
    // 100 LF at 25 LF/hr = 4 hr; doubling the quantity must double the hours,
    // not leave $320 of crew behind in the grand total.
    expect(laborHoursForQuantity({ quantity: 100, currentLaborHours: 0, rate, manualFields: [] }))
      .toBe(4);
    expect(laborHoursForQuantity({ quantity: 200, currentLaborHours: 4, rate, manualFields: [] }))
      .toBe(8);
  });

  it('leaves hours alone when the user typed them', () => {
    expect(
      laborHoursForQuantity({
        quantity: 200,
        currentLaborHours: 4,
        rate,
        manualFields: ['laborHours'],
      })
    ).toBe(4);
  });

  it('leaves hours alone when there is no usable rate', () => {
    for (const r of [null, undefined, {}, { rate_per_hour: 0 }, { rate_per_hour: null }]) {
      expect(
        laborHoursForQuantity({ quantity: 200, currentLaborHours: 4, rate: r as any, manualFields: [] })
      ).toBe(4);
    }
  });

  it('rounds the way the modal does', () => {
    // 7 LF at 3 LF/hr = 2.333… hr
    expect(
      laborHoursForQuantity({ quantity: 7, currentLaborHours: 0, rate: { rate_per_hour: 3 }, manualFields: [] })
    ).toBeCloseTo(2.33, 2);
  });

  it('is unaffected by an override on a different field', () => {
    expect(
      laborHoursForQuantity({
        quantity: 200,
        currentLaborHours: 4,
        rate,
        manualFields: ['materialUnitCost'],
      })
    ).toBe(8);
  });
});
