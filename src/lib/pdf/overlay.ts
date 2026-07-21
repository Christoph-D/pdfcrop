export const MAX_PAGE_HEIGHT = 900;
export const IDENTICAL_PIXELS_THRESHOLD = 0.8;

export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

function scaleToHeight(src: GrayImage, targetHeight: number): GrayImage {
  if (src.height === targetHeight) return src;
  const scale = targetHeight / src.height;
  const targetWidth = Math.max(1, Math.round(src.width * scale));
  const out = new Uint8Array(targetWidth * targetHeight);
  // Nearest-neighbor downsample
  for (let y = 0; y < targetHeight; y++) {
    const srcY = Math.min(src.height - 1, Math.floor(y / scale));
    const srcRow = srcY * src.width;
    const dstRow = y * targetWidth;
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.min(src.width - 1, Math.floor(x / scale));
      out[dstRow + x] = src.data[srcRow + srcX]!;
    }
  }
  return { width: targetWidth, height: targetHeight, data: out };
}

/**
 * Port of ClusterImageData.calculateOverlayOfImages.
 *
 * Computes a single grayscale preview across N page images such that:
 *  - bright pixels = whitespace on every page
 *  - dim pixels = content present
 *  - regions where content appears at the same location on every page are preserved
 *
 * Strategy: scale all images to a common height (<= MAX_PAGE_HEIGHT), then
 * either emit the per-pixel standard-deviation projection (255 - sd) or, when
 * pages are nearly identical, the per-pixel minimum projection.
 */
export function calculateOverlay(images: GrayImage[]): GrayImage | null {
  if (images.length === 0) return null;

  // All source images scaled to height <= MAX_PAGE_HEIGHT
  const first = images[0]!;
  const targetHeight = Math.min(first.height, MAX_PAGE_HEIGHT);
  const scaled = images.map((img) => scaleToHeight(img, targetHeight));
  const firstScaled = scaled[0]!;
  const width = firstScaled.width;
  const height = firstScaled.height;
  const n = scaled.length;
  const npix = width * height;

  const mean = new Float64Array(npix);
  const minProj = new Uint8Array(npix).fill(255);
  let identicalPixels = 0;
  let whitePixels = 0;

  // Accumulate sum and min per pixel across all images
  for (let imgIdx = 0; imgIdx < n; imgIdx++) {
    const data = scaled[imgIdx]!.data;
    for (let i = 0; i < npix; i++) {
      const v = data[i]!;
      mean[i] = (mean[i] ?? 0) + v;
      if (v < (minProj[i] ?? 255)) minProj[i] = v;
    }
  }
  for (let i = 0; i < npix; i++) mean[i] = (mean[i] ?? 0) / n;

  // Variance per pixel, count identical and white pixels
  const sd = new Float64Array(npix);
  for (let imgIdx = 0; imgIdx < n; imgIdx++) {
    const data = scaled[imgIdx]!.data;
    for (let i = 0; i < npix; i++) {
      const d = data[i]! - (mean[i] ?? 0);
      sd[i] = (sd[i] ?? 0) + d * d;
    }
  }

  for (let i = 0; i < npix; i++) {
    const m = mean[i] ?? 0;
    if (m === 255) {
      whitePixels++;
      continue;
    }
    // "identical" in Briss = content present at the same place on every page
    // (mean<255 and sd==0 after rounding to int)
    if (m < 255 && (sd[i] ?? 0) === 0) {
      identicalPixels++;
    }
  }

  // Decide projection: if most non-white pixels are identical, use min; else sd.
  const useFallback =
    identicalPixels > npix * IDENTICAL_PIXELS_THRESHOLD - whitePixels;

  const out = new Uint8Array(npix);
  if (useFallback) {
    out.set(minProj);
  } else {
    // 255 - sqrt(variance/(N-1))
    const denom = Math.max(1, n - 1);
    for (let i = 0; i < npix; i++) {
      const v = (sd[i] ?? 0) / denom;
      out[i] = Math.max(0, 255 - Math.round(Math.sqrt(v)));
    }
  }
  return { width, height, data: out };
}

/** Convert a grayscale image to an RGBA Uint8ClampedArray for canvas / ImageData. */
export function grayscaleToRgba(gray: GrayImage): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.width * gray.height * 4);
  for (let i = 0, j = 0; i < gray.data.length; i++, j += 4) {
    const v = gray.data[i]!;
    out[j] = v;
    out[j + 1] = v;
    out[j + 2] = v;
    out[j + 3] = 255;
  }
  return out;
}

/** Serialize a GrayImage to a PNG data URL via OffscreenCanvas / canvas. */
export function grayImageToDataUrl(gray: GrayImage): string {
  const canvas = document.createElement("canvas");
  canvas.width = gray.width;
  canvas.height = gray.height;
  const ctx = canvas.getContext("2d")!;
  const imgData = ctx.createImageData(gray.width, gray.height);
  imgData.data.set(grayscaleToRgba(gray));
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL("image/png");
}
