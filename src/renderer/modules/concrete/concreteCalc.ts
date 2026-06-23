/**
 * Concrete takeoff calculation engine.
 *
 * Pure functions -- no React, no side effects. Mirrors the trenchCalc.ts
 * convention so it can be reused by the standalone ConcreteCalculator
 * component and, later, by the plan-takeoff overlay (slab areas already
 * flow through "the area thing").
 *
 * Concrete is universally bought by the cubic yard, formwork is measured by
 * square feet of contact area (SFCA), and reinforcement by length/weight, so
 * the calculator's job is to turn plan dimensions into those purchase units.
 */

import type { CalcBreakdown } from '../../../shared/calcExplain';
import { fmtNum } from '../../../shared/calcExplain';
import {
  cubicFeetToYards,
  inchesToFeet,
  CUBIC_FEET_PER_CUBIC_YARD,
} from '../../../shared/constants/units';

// ---- Input / Output types --------------------------------------------------

/** What kind of element we're estimating -- changes how forms are measured. */
export type ConcreteElement = 'slab' | 'footing' | 'wall';

export interface ConcreteInput {
  element: ConcreteElement;
  /** Plan area of the placement, SF. For walls this is length x height. */
  areaSF: number;
  /** Thickness for slabs/footings, or wall thickness, inches. */
  thicknessIn: number;
  /** Perimeter of the placement, LF -- drives edge formwork. */
  perimeterLF: number;
  /** Form height for the edge/face, inches (defaults to thickness for slabs). */
  formHeightIn: number;
  /** For walls, whether both faces are formed (true) or one (false). */
  formBothFaces: boolean;
  /** Concrete over-order allowance, percent (spillage, sub-grade, waste). */
  wastePct: number;
  /** Rebar grid spacing each way, inches (0 = no rebar grid). */
  rebarSpacingIn: number;
  /** Welded wire mesh instead of/with rebar -- counts mesh SF = areaSF. */
  includeMesh: boolean;
  /** Granular subbase depth beneath a slab, inches (0 = none). */
  subbaseIn: number;
}

export interface ConcreteOutput {
  /** Neat-line concrete volume before waste, CY. */
  neatCY: number;
  /** Concrete to order including waste, CY. */
  orderCY: number;
  /** Square feet of form contact area. */
  formSFCA: number;
  /** Linear feet of rebar in the grid (both directions), LF. */
  rebarLF: number;
  /** Welded wire mesh area, SF (0 when not included). */
  meshSF: number;
  /** Subbase aggregate volume, CY (0 when no subbase). */
  subbaseCY: number;
  /** Finished surface area to trowel/cure, SF (slabs only). */
  finishSF: number;
}

export interface ValidationError {
  field: string;
  message: string;
}

// ---- Defaults --------------------------------------------------------------

export const DEFAULT_WASTE_PCT = 8;

// ---- Validation ------------------------------------------------------------

export function validateInput(input: ConcreteInput): ValidationError[] {
  const errors: ValidationError[] = [];

  if (input.areaSF <= 0)
    errors.push({ field: 'areaSF', message: 'Area must be greater than 0' });
  if (input.thicknessIn <= 0)
    errors.push({ field: 'thicknessIn', message: 'Thickness must be greater than 0' });
  if (input.perimeterLF < 0)
    errors.push({ field: 'perimeterLF', message: 'Perimeter cannot be negative' });
  if (input.formHeightIn < 0)
    errors.push({ field: 'formHeightIn', message: 'Form height cannot be negative' });
  if (input.wastePct < 0 || input.wastePct > 100)
    errors.push({ field: 'wastePct', message: 'Waste must be between 0 and 100%' });
  if (input.rebarSpacingIn < 0)
    errors.push({ field: 'rebarSpacingIn', message: 'Rebar spacing cannot be negative' });
  if (input.subbaseIn < 0)
    errors.push({ field: 'subbaseIn', message: 'Subbase depth cannot be negative' });

  return errors;
}

// ---- Core calc -------------------------------------------------------------

/**
 * Linear feet of rebar laid out as a grid on `areaSF` at `spacingIn` both
 * ways. Treats the area as a square of side sqrt(areaSF); the bar count in
 * each direction is span/spacing + 1, and total length is bars x span,
 * doubled for the two directions. Good enough for takeoff; exact layouts
 * vary with bar placement and laps.
 */
export function rebarGridLF(areaSF: number, spacingIn: number): number {
  if (areaSF <= 0 || spacingIn <= 0) return 0;
  const side = Math.sqrt(areaSF);            // ft
  const spacingFt = inchesToFeet(spacingIn);
  const barsPerDir = Math.floor(side / spacingFt) + 1;
  // length per bar ~ side; two directions
  return barsPerDir * side * 2;
}

export function calculateConcrete(input: ConcreteInput): ConcreteOutput {
  const thicknessFt = inchesToFeet(input.thicknessIn);
  const neatCF = input.areaSF * thicknessFt;
  const neatCY = cubicFeetToYards(neatCF);
  const orderCY = neatCY * (1 + input.wastePct / 100);

  // Edge forms for a slab/footing run the perimeter at the slab depth (or a
  // user-set form height). Walls are formed on one or both faces over their
  // plan area, so contact area is areaSF x faces.
  let formSFCA: number;
  if (input.element === 'wall') {
    const faces = input.formBothFaces ? 2 : 1;
    formSFCA = input.areaSF * faces;
  } else {
    const heightFt = inchesToFeet(input.formHeightIn || input.thicknessIn);
    formSFCA = input.perimeterLF * heightFt;
  }

  const rebarLF = rebarGridLF(input.areaSF, input.rebarSpacingIn);
  const meshSF = input.includeMesh ? input.areaSF : 0;

  const subbaseCY = input.subbaseIn > 0
    ? cubicFeetToYards(input.areaSF * inchesToFeet(input.subbaseIn))
    : 0;

  // Only slabs get a troweled/cured top surface in the takeoff sense.
  const finishSF = input.element === 'slab' ? input.areaSF : 0;

  return {
    neatCY,
    orderCY,
    formSFCA,
    rebarLF,
    meshSF,
    subbaseCY,
    finishSF,
  };
}

// ---- Math explanation (for the CalcPopover) --------------------------------

export function explainConcrete(input: ConcreteInput, out: ConcreteOutput): {
  order: CalcBreakdown;
  forms: CalcBreakdown;
  rebar: CalcBreakdown | null;
  subbase: CalcBreakdown | null;
} {
  const cy = (n: number) => `${fmtNum(n, 2)} CY`;
  const sf = (n: number) => `${fmtNum(n, 1)} SF`;
  const thicknessFt = inchesToFeet(input.thicknessIn);
  const neatCF = input.areaSF * thicknessFt;

  const forms: CalcBreakdown = input.element === 'wall'
    ? {
        formula: 'Form contact area = wall area × faces formed',
        lines: [
          { label: 'Wall area', value: sf(input.areaSF), kind: 'term' },
          { label: 'Faces formed', value: `${input.formBothFaces ? 2 : 1}`, kind: 'term' },
          { label: 'Contact area', value: `${fmtNum(out.formSFCA, 1)} SFCA`, kind: 'result' },
        ],
      }
    : {
        formula: 'Edge form area = perimeter × form height',
        lines: [
          { label: 'Perimeter', value: `${fmtNum(input.perimeterLF, 2)} LF`, kind: 'term' },
          { label: 'Form height', value: `${fmtNum(inchesToFeet(input.formHeightIn || input.thicknessIn), 2)} ft`, kind: 'term' },
          { label: 'Contact area', value: `${fmtNum(out.formSFCA, 1)} SFCA`, kind: 'result' },
        ],
      };

  return {
    order: {
      formula: 'Order = (area × thickness ÷ 27) × (1 + waste)',
      lines: [
        { label: 'Area', value: sf(input.areaSF), kind: 'term' },
        { label: 'Thickness', value: `${fmtNum(thicknessFt, 3)} ft`, kind: 'term' },
        { label: 'Neat volume', value: `${fmtNum(neatCF, 1)} CF ÷ ${CUBIC_FEET_PER_CUBIC_YARD} = ${cy(out.neatCY)}`, kind: 'term' },
        { label: `Waste (${fmtNum(input.wastePct, 1)}%)`, value: `× ${fmtNum(1 + input.wastePct / 100, 3)}`, kind: 'term' },
        { label: 'Order volume', value: cy(out.orderCY), kind: 'result' },
      ],
      note: 'Round up to the nearest 1/4 CY when ordering; suppliers bill by the full yard.',
    },
    forms,
    rebar: out.rebarLF > 0 ? {
      formula: 'Rebar = bars-per-direction × span × 2 directions',
      lines: [
        { label: 'Area', value: sf(input.areaSF), kind: 'term' },
        { label: 'Spacing', value: `${fmtNum(input.rebarSpacingIn, 1)}" o.c. each way`, kind: 'term' },
        { label: 'Grid length', value: `${fmtNum(out.rebarLF, 1)} LF`, kind: 'result' },
      ],
      note: 'Approximates the slab as a square; excludes laps and bends.',
    } : null,
    subbase: out.subbaseCY > 0 ? {
      formula: 'Subbase = area × depth ÷ 27',
      lines: [
        { label: 'Area', value: sf(input.areaSF), kind: 'term' },
        { label: 'Depth', value: `${fmtNum(inchesToFeet(input.subbaseIn), 3)} ft`, kind: 'term' },
        { label: 'Subbase', value: cy(out.subbaseCY), kind: 'result' },
      ],
    } : null,
  };
}
