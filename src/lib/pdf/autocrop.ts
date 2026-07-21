import type { GrayImage } from "./overlay";

export const SD_CALC_SIZE_NR = 5;
export const LOOK_AHEAD_PIXEL_NR = 30;
export const RATIO_LOOK_AHEAD_SATISFY = 0.85;
export const SD_THRESHOLD_TO_BE_COUNTED = 0.2;

export type Orientation = "left" | "top" | "right" | "bottom";
export type Axis = "x" | "y";

function axisProjection(img: GrayImage, axis: Axis): Float64Array {
  if (axis === "x") {
    const out = new Float64Array(img.width);
    for (let y = 0; y < img.height; y++) {
      const row = y * img.width;
      for (let x = 0; x < img.width; x++) {
        out[x] = (out[x] ?? 0) + img.data[row + x]!;
      }
    }
    for (let x = 0; x < img.width; x++) out[x] = (out[x] ?? 0) / img.height;
    return out;
  }
  const out = new Float64Array(img.height);
  for (let y = 0; y < img.height; y++) {
    const row = y * img.width;
    for (let x = 0; x < img.width; x++) {
      out[y] = (out[y] ?? 0) + img.data[row + x]!;
    }
  }
  for (let y = 0; y < img.height; y++) out[y] = (out[y] ?? 0) / img.width;
  return out;
}

function derivation(values: Float64Array): Float64Array {
  if (values.length < 2) return new Float64Array(0);
  const out = new Float64Array(values.length - 1);
  for (let i = 0; i < values.length - 1; i++) {
    out[i] = (values[i + 1] ?? 0) - (values[i] ?? 0);
  }
  return out;
}

function sdOfDerivation(diff: Float64Array): Float64Array {
  if (diff.length < SD_CALC_SIZE_NR) return new Float64Array(0);
  const out = new Float64Array(diff.length - SD_CALC_SIZE_NR + 1);
  for (let i = 0; i < out.length; i++) {
    let mean = 0;
    for (let j = 0; j < SD_CALC_SIZE_NR; j++) mean += diff[i + j] ?? 0;
    mean /= SD_CALC_SIZE_NR;
    let variance = 0;
    for (let j = 0; j < SD_CALC_SIZE_NR; j++) {
      const d = (diff[i + j] ?? 0) - mean;
      variance += d * d;
    }
    out[i] = Math.sqrt(variance / (SD_CALC_SIZE_NR - 1));
  }
  return out;
}

function findPosition(sds: Float64Array, orientation: Orientation): number {
  const len = sds.length;
  if (len === 0) return 0;
  const forward = orientation === "left" || orientation === "top";
  for (let i = 0; i < len; i++) {
    const idx = forward ? i : len - 1 - i;
    if ((sds[idx] ?? 0) < SD_THRESHOLD_TO_BE_COUNTED) continue;
    let countAbove = 0;
    for (let k = 0; k < LOOK_AHEAD_PIXEL_NR; k++) {
      const probe = forward ? idx + k : idx - k;
      if (probe < 0 || probe >= len) break;
      if ((sds[probe] ?? 0) >= SD_THRESHOLD_TO_BE_COUNTED) countAbove++;
    }
    if (countAbove / LOOK_AHEAD_PIXEL_NR >= RATIO_LOOK_AHEAD_SATISFY) {
      return idx;
    }
  }
  return forward ? 0 : len - 1;
}

/**
 * Auto-crop detection. Port of CropFinder.getAutoCropFloats.
 * Returns margin ratios [left, bottom, right, top] suitable for our pipeline.
 */
export function getAutoCropRatios(img: GrayImage): import("./ratios").Ratios {
  const sdXFull = sdOfDerivation(derivation(axisProjection(img, "x")));
  const sdYFull = sdOfDerivation(derivation(axisProjection(img, "y")));

  const xLeft = findPosition(sdXFull, "left");
  const xRight = findPosition(sdXFull, "right");
  const yTop = findPosition(sdYFull, "top");
  const yBottom = findPosition(sdYFull, "bottom");

  const w = sdXFull.length || img.width;
  const h = sdYFull.length || img.height;

  const left = xLeft / w;
  const right = (w - xRight) / w;
  const top = yTop / h;
  const bottom = (h - yBottom) / h;

  return [clamp01(left), clamp01(bottom), clamp01(right), clamp01(top)];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
