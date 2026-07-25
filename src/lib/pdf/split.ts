import type { GrayImage } from "./overlay";
import type { PixelRect } from "./ratios";

/**
 * Split a crop rectangle into two at the minimum-content-variance seam near its
 * middle. Port of Briss's `SplitFinder.splitColumn` / `splitRow`, originally
 * surfaced via `PopUpMenuForCropRectangles` in `MergedPanel`.
 *
 * Briss computed the seam over the entire merged preview (its `getSplitRatio`
 * carried a TODO to restrict it to the crop). Here we project only the pixels
 * inside the crop rect, so the seam is found near the *rect's* middle — which is
 * what the context-menu action promises and what makes the split correct for
 * off-centre rects.
 */

/** Centre of the search window, as a fraction of the crop extent. */
export const LOOK_RATIO = 0.5;
/** Total width of the search window (±5% of the crop extent). */
export const MAX_DIST_RATIO = 0.1;
/** Per-side overlap kept between the two halves of a row split, as a fraction
 *  of the crop height — the halves share a sliver so ascenders / descenders
 *  straddling the seam aren't clipped. */
export const ROW_OVERLAP_RATIO = 0.01;

/** Window size for the rolling standard deviation (matches Briss). */
const SD_CALC_SIZE_NR = 5;

export type SplitAxis = "column" | "row";

/**
 * Average pixel value per column (`"column"`) or per row (`"row"`) inside
 * `rect`. Port of `ImageFinderUtil.sumFrom2dTo1d`, restricted to the crop.
 */
function projection(img: GrayImage, rect: PixelRect, axis: SplitAxis): Float64Array {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(img.width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(img.height, Math.ceil(rect.y + rect.h));
  if (axis === "column") {
    const w = Math.max(0, x1 - x0);
    const out = new Float64Array(w);
    const h = Math.max(1, y1 - y0);
    for (let y = y0; y < y1; y++) {
      const row = y * img.width;
      for (let x = x0; x < x1; x++) out[x - x0]! += img.data[row + x]!;
    }
    for (let i = 0; i < w; i++) out[i]! /= h;
    return out;
  }
  const h = Math.max(0, y1 - y0);
  const out = new Float64Array(h);
  const w = Math.max(1, x1 - x0);
  for (let y = y0; y < y1; y++) {
    const row = y * img.width;
    for (let x = x0; x < x1; x++) out[y - y0]! += img.data[row + x]!;
  }
  for (let i = 0; i < h; i++) out[i]! /= w;
  return out;
}

/**
 * Rolling standard deviation of the first derivative — port of Briss's
 * `ImageFinderUtil.createSdOfDerivation(double[])`. The output has the same
 * length as the derivation (out-of-range taps count as 0), so index `i` maps
 * directly to position `i`. Uses population SD, as Briss does.
 */
function sdOfDerivation(values: Float64Array): Float64Array {
  if (values.length < 2) return new Float64Array(0);
  const deriv = new Float64Array(values.length - 1);
  for (let i = 0; i < deriv.length; i++) deriv[i] = values[i + 1]! - values[i]!;
  const sds = new Float64Array(deriv.length);
  for (let i = 0; i < sds.length; i++) {
    let mean = 0;
    for (let j = 0; j < SD_CALC_SIZE_NR; j++) {
      mean += i + j < deriv.length ? deriv[i + j]! : 0;
    }
    mean /= SD_CALC_SIZE_NR;
    let variance = 0;
    for (let j = 0; j < SD_CALC_SIZE_NR; j++) {
      const d = (i + j < deriv.length ? deriv[i + j]! : 0) - mean;
      variance += d * d;
    }
    sds[i] = Math.sqrt(variance / SD_CALC_SIZE_NR);
  }
  return sds;
}

/**
 * Argmin of `sdOfDerivation` over the middle ±(MAX_DIST_RATIO / 2) window.
 * Returns the seam as an index into `sds` (i.e. an offset from the crop's
 * left/top edge). Port of `SplitFinder.getSplitRatio`: the window is sized by
 * `extent` (the number of columns / rows in the crop, matching Briss's
 * `image.getWidth()`), not by the shorter `sds` array. Falls back to the exact
 * middle when the window is empty.
 */
function findSeamOffset(sds: Float64Array, extent: number): number {
  if (sds.length === 0 || extent < 1) return 0;
  const rangeStart = Math.max(0, Math.floor(extent * (LOOK_RATIO - MAX_DIST_RATIO / 2)));
  const rangeEnd = Math.min(sds.length, Math.ceil(extent * (LOOK_RATIO + MAX_DIST_RATIO / 2)));
  const fallback = Math.min(sds.length - 1, Math.floor(extent * LOOK_RATIO));
  if (rangeEnd <= rangeStart) return fallback;
  let min = Infinity;
  let minIndex = fallback;
  for (let i = rangeStart; i < rangeEnd; i++) {
    const v = sds[i] ?? 0;
    if (v < min) {
      min = v;
      minIndex = i;
    }
  }
  return minIndex;
}

/**
 * Pixel coordinate of the minimum-content-variance seam inside `rect`, measured
 * from the image origin. For `"column"` this is an x (a vertical seam); for
 * `"row"` a y (a horizontal seam).
 */
export function findSplitSeam(img: GrayImage, rect: PixelRect, axis: SplitAxis): number {
  const proj = projection(img, rect, axis);
  const sds = sdOfDerivation(proj);
  const origin = axis === "column" ? Math.max(0, Math.floor(rect.x)) : Math.max(0, Math.floor(rect.y));
  return origin + findSeamOffset(sds, proj.length);
}

/**
 * Replace `rect` with two crops split at the min-variance vertical seam near its
 * horizontal middle. Port of `SplitFinder.splitColumn`. The two halves tile the
 * original rect exactly (no overlap).
 */
export function splitColumn(img: GrayImage, rect: PixelRect): [PixelRect, PixelRect] {
  const seamX = findSplitSeam(img, rect, "column");
  const left: PixelRect = { x: rect.x, y: rect.y, w: seamX - rect.x, h: rect.h };
  const right: PixelRect = { x: seamX, y: rect.y, w: rect.x + rect.w - seamX, h: rect.h };
  return [normalise(left), normalise(right)];
}

/**
 * Replace `rect` with two crops split at the min-variance horizontal seam near
 * its vertical middle. Port of `SplitFinder.splitRow`. Each half is extended by
 * `ROW_OVERLAP_RATIO` of the crop height past the seam so the two halves share a
 * sliver (prevents clipping ascenders / descenders straddling the seam).
 */
export function splitRow(img: GrayImage, rect: PixelRect): [PixelRect, PixelRect] {
  const seamY = findSplitSeam(img, rect, "row");
  const overlap = ROW_OVERLAP_RATIO * rect.h;
  const top: PixelRect = { x: rect.x, y: rect.y, w: rect.w, h: seamY + overlap - rect.y };
  const bottom: PixelRect = {
    x: rect.x,
    y: seamY - overlap,
    w: rect.w,
    h: rect.y + rect.h - (seamY - overlap),
  };
  return [normalise(top), normalise(bottom)];
}

/** Guard against sign flips / negative extents from degenerate inputs. */
function normalise(r: PixelRect): PixelRect {
  return {
    x: Math.min(r.x, r.x + r.w),
    y: Math.min(r.y, r.y + r.h),
    w: Math.max(0, Math.abs(r.w)),
    h: Math.max(0, Math.abs(r.h)),
  };
}
