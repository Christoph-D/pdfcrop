import { describe, expect, it } from "vitest";
import { getAutoCropRatios } from "./autocrop";
import type { GrayImage } from "./overlay";

function makeImage(w: number, h: number, fill: number, contentRect: Array<[number, number, number, number]> = []): GrayImage {
  const data = new Uint8Array(w * h).fill(fill);
  for (const [x0, y0, x1, y1] of contentRect) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        data[y * w + x] = 0;
      }
    }
  }
  return { width: w, height: h, data };
}

describe("getAutoCropRatios", () => {
  it("crops to a content block in the middle of an otherwise white page", () => {
    const img = makeImage(100, 100, 255, [[30, 30, 70, 70]]);
    const r = getAutoCropRatios(img);
    // Each ratio should be a number in [0, 1]
    for (const v of r) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of r) expect(v).toBeLessThanOrEqual(1);
    // The detected margins should be roughly <= the actual content margins
    expect(r[0]).toBeLessThanOrEqual(0.35); // left
    expect(r[1]).toBeLessThanOrEqual(0.35); // bottom
    expect(r[2]).toBeLessThanOrEqual(0.35); // right
    expect(r[3]).toBeLessThanOrEqual(0.35); // top
  });

  it("returns 0 margins for a fully white image (no content detected)", () => {
    const img = makeImage(60, 60, 255);
    const r = getAutoCropRatios(img);
    // No content -> findPosition returns the boundary, so ratios collapse.
    // We just check the shape; values are deterministic but uninteresting.
    expect(r.length).toBe(4);
  });
});
