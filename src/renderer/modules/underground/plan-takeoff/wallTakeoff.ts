/**
 * Wall-run takeoff math. Pure functions — no React, no IPC.
 *
 * A wall is traced as an open polyline; its length comes from the page scale.
 * The plan view can't supply height or thickness, so those ride on the wall's
 * config. From length × height × thickness we get concrete volume, formwork
 * contact area (SFCA = face area × faces formed), and an optional rebar grid
 * laid over one wall face.
 */
import { cubicFeetToYards, inchesToFeet } from '../../../../shared/constants/units';
import { rebarGridLF } from '../../concrete/concreteCalc';

export interface WallQuantities {
  lengthLF: number;
  faceSF: number;     // one-face area, length × height
  concreteCY: number; // length × height × thickness
  formSFCA: number;   // faceSF × faces formed
  rebarLF: number;    // grid over one face (0 when spacing is 0)
}

export function computeWallQuantities(args: {
  lengthLF: number;
  heightFt: number;
  thicknessIn: number;
  faces: number;
  rebarSpacingIn: number;
}): WallQuantities {
  const { lengthLF, heightFt, thicknessIn, faces, rebarSpacingIn } = args;
  const faceSF = lengthLF * heightFt;
  const concreteCF = faceSF * inchesToFeet(thicknessIn);
  return {
    lengthLF,
    faceSF,
    concreteCY: cubicFeetToYards(concreteCF),
    formSFCA: faceSF * faces,
    rebarLF: rebarSpacingIn > 0 ? rebarGridLF(faceSF, rebarSpacingIn) : 0,
  };
}
