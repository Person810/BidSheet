/**
 * Wall-run takeoff math. Pure functions — no React, no IPC, no trade coupling.
 *
 * A wall is traced as an open polyline; its length comes from the page scale.
 * The plan view can't supply height or thickness, so those — plus the number
 * of finished/formed faces and an optional vertical-member spacing — ride on
 * the wall's config. Outputs are deliberately generic so the tool serves any
 * wall trade: cast-in-place concrete, stud framing, masonry, etc. "Members"
 * are the vertical pieces spaced along the run (studs, bars, posts, furring).
 */
import { cubicFeetToYards, inchesToFeet } from '../../../../shared/constants/units';

export interface WallQuantities {
  lengthLF: number;    // measured run length
  faceSF: number;      // one face, length × height
  surfaceSF: number;   // faceSF × faces (forms / sheathing / finish / cladding)
  volumeCY: number;    // length × height × thickness (solid walls)
  memberCount: number; // vertical members at spacing (0 = none)
  memberLF: number;    // memberCount × height
}

export function computeWallQuantities(args: {
  lengthLF: number;
  heightFt: number;
  thicknessIn: number;
  faces: number;
  memberSpacingIn: number;
}): WallQuantities {
  const { lengthLF, heightFt, thicknessIn, faces, memberSpacingIn } = args;
  const faceSF = lengthLF * heightFt;
  const volumeCF = faceSF * inchesToFeet(thicknessIn);

  // Vertical members spaced along the run, each one full wall height. Count is
  // the number of spacing intervals plus the closing member.
  const spacingFt = inchesToFeet(memberSpacingIn);
  const memberCount = memberSpacingIn > 0 && lengthLF > 0
    ? Math.floor(lengthLF / spacingFt) + 1
    : 0;

  return {
    lengthLF,
    faceSF,
    surfaceSF: faceSF * faces,
    volumeCY: cubicFeetToYards(volumeCF),
    memberCount,
    memberLF: memberCount * heightFt,
  };
}
