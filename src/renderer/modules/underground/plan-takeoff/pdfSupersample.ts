/* ---- Supersampling ----
 * Rasterizing a plan sheet at its display size puts hairlines and small text
 * below one pixel, where antialiasing smears them into grey mush — the
 * zoomed-out "blurry PDF" problem. Rendering above display size and letting
 * the browser downscale recovers most of that detail.
 *
 * This lives apart from PdfViewer so it stays testable without importing
 * pdfjs-dist, which needs a browser (and a newer Node than CI runs) just to
 * load.
 */

/** Device pixels per PDF point we aim to rasterize at. Deliberately just
 *  above 1:1 — the goal is to claw back the zoomed-out case without inflating
 *  bitmaps at high zoom, where a full-page render is already expensive. */
const TARGET_DENSITY = 1.25;
/** Ceiling on the multiplier, so a very low zoom can't ask for a huge bitmap. */
const MAX_SUPERSAMPLE = 2.5;
/** Device-pixel budget for one page bitmap (~24M px ≈ 96 MB at RGBA). */
const MAX_CANVAS_PX = 24_000_000;

/**
 * How much to oversample a page render.
 *
 * `displayScale * dpr` is the density the page would rasterize at natively;
 * anything below TARGET_DENSITY gets scaled up toward it, then clamped so the
 * bitmap stays inside the pixel budget. Returns 1 when the native density is
 * already sufficient (zoomed in), making this a no-op at high zoom.
 */
export function supersampleFactor(
  displayScale: number, dpr: number, pageW: number, pageH: number,
  budgetPx: number = MAX_CANVAS_PX,
): number {
  const density = displayScale * dpr;
  if (!(density > 0) || !(pageW > 0) || !(pageH > 0)) return 1;

  const wanted = Math.min(MAX_SUPERSAMPLE, Math.max(1, TARGET_DENSITY / density));

  // Clamp against the budget: pixels grow with the square of the factor.
  const basePx = pageW * displayScale * dpr * pageH * displayScale * dpr;
  if (basePx <= 0) return wanted;
  const maxByBudget = Math.sqrt(budgetPx / basePx);
  return Math.max(1, Math.min(wanted, maxByBudget));
}
