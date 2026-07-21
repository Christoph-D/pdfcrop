import { describe, expect, it } from "vitest";
import { calculateOverlay, type GrayImage } from "./overlay";

function makeImage(w: number, h: number, fill: number, dark: Array<[number, number]> = []): GrayImage {
  const data = new Uint8Array(w * h).fill(fill);
  for (const [x, y] of dark) data[y * w + x] = 0;
  return { width: w, height: h, data };
}

describe("calculateOverlay", () => {
  it("returns null for empty input", () => {
    expect(calculateOverlay([])).toBeNull();
  });

  it("returns a white image when all pages are entirely white", () => {
    const result = calculateOverlay([makeImage(10, 10, 255), makeImage(10, 10, 255)])!;
    expect(result.width).toBe(10);
    expect(result.height).toBe(10);
    for (let i = 0; i < result.data.length; i++) {
      expect(result.data[i]).toBe(255);
    }
  });

  it("uses min-projection when content is at the same place on every page", () => {
    // Identical images with a dark dot at (3,3) — identical-pixel threshold triggers fallback.
    const a = makeImage(10, 10, 255, [[3, 3]]);
    const b = makeImage(10, 10, 255, [[3, 3]]);
    const c = makeImage(10, 10, 255, [[3, 3]]);
    const result = calculateOverlay([a, b, c])!;
    expect(result.data[3 * 10 + 3]).toBe(0); // dark dot preserved via min projection
  });

  it("uses sd-projection when content differs across pages", () => {
    // Dark dot in different locations on each page — sd-projection should leave a dim
    // region somewhere in the output (not pure white).
    const a = makeImage(20, 20, 255, [[2, 2]]);
    const b = makeImage(20, 20, 255, [[10, 10]]);
    const c = makeImage(20, 20, 255, [[17, 17]]);
    const result = calculateOverlay([a, b, c])!;
    // The three dark pixels and their neighborhoods should make the output
    // dimmer than 255 somewhere
    const hasDim = Array.from(result.data).some((v) => v < 255);
    expect(hasDim).toBe(true);
  });

  it("scales pages down to MAX_PAGE_HEIGHT=900 keeping aspect", () => {
    const tall = { width: 1000, height: 1800, data: new Uint8Array(1000 * 1800).fill(255) };
    const result = calculateOverlay([tall])!;
    expect(result.height).toBe(900);
    expect(result.width).toBe(500);
  });
});
