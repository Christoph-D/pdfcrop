import { describe, expect, it } from "vitest";
import type { GrayImage } from "./overlay";
import { LOOK_RATIO, MAX_DIST_RATIO, ROW_OVERLAP_RATIO, findSplitSeam, splitColumn, splitRow } from "./split";

function makeImage(w: number, h: number, fill: number): GrayImage {
  return { width: w, height: h, data: new Uint8Array(w * h).fill(fill) };
}

/** Set every pixel in column `x` to `value`. */
function fillColumn(img: GrayImage, x: number, value: number): void {
  for (let y = 0; y < img.height; y++) img.data[y * img.width + x] = value;
}

/** Set every pixel in row `y` to `value`. */
function fillRow(img: GrayImage, y: number, value: number): void {
  for (let x = 0; x < img.width; x++) img.data[y * img.width + x] = value;
}

describe("constants", () => {
  it("exposes the Briss split constants", () => {
    expect(LOOK_RATIO).toBe(0.5);
    expect(MAX_DIST_RATIO).toBe(0.1);
    expect(ROW_OVERLAP_RATIO).toBe(0.01);
  });
});

describe("findSplitSeam", () => {
  it("lands the column seam on a vertical gutter near the middle", () => {
    // 100x10 image, white background, a flat gutter band at columns 47-53.
    const img = makeImage(100, 10, 255);
    // Left/right content: alternating columns so sd-of-derivation is high.
    for (let x = 0; x < 47; x += 2) fillColumn(img, x, 0);
    for (let x = 54; x < 100; x += 2) fillColumn(img, x, 0);
    // Gutter (flat) guarantees sd == 0 across columns 47..53.
    const seam = findSplitSeam(img, { x: 0, y: 0, w: 100, h: 10 }, "column");
    // Seam must lie inside the middle ±5% window [45, 55).
    expect(seam).toBeGreaterThanOrEqual(45);
    expect(seam).toBeLessThanOrEqual(54);
  });

  it("constrains the seam to the middle ±5% window even on noisy content", () => {
    const img = makeImage(100, 10, 255);
    // Busy content everywhere — no obvious gutter.
    for (let x = 0; x < 100; x += 2) fillColumn(img, x, x % 4 === 0 ? 0 : 128);
    const seam = findSplitSeam(img, { x: 0, y: 0, w: 100, h: 10 }, "column");
    expect(seam).toBeGreaterThanOrEqual(45);
    expect(seam).toBeLessThanOrEqual(54);
  });

  it("falls back gracefully for a tiny rect", () => {
    const img = makeImage(20, 20, 255);
    const seam = findSplitSeam(img, { x: 5, y: 5, w: 1, h: 1 }, "column");
    // No crash; seam sits at the rect's origin.
    expect(seam).toBe(5);
  });
});

describe("splitColumn", () => {
  it("replaces the rect with two halves that tile it exactly, seam near the middle", () => {
    const img = makeImage(100, 10, 255);
    const rect = { x: 10, y: 5, w: 80, h: 6 };
    const [left, right] = splitColumn(img, rect);

    // Left half starts at the rect's left edge; right half ends at its right.
    expect(left.x).toBe(rect.x);
    expect(right.x + right.w).toBeCloseTo(rect.x + rect.w);
    // The seam is the shared boundary.
    expect(right.x).toBe(left.x + left.w);
    // Columns tile exactly with no overlap/gap.
    expect(left.w + right.w).toBeCloseTo(rect.w, 5);
    // Heights and y preserved.
    expect(left.y).toBe(rect.y);
    expect(left.h).toBeCloseTo(rect.h);
    expect(right.y).toBe(rect.y);
    expect(right.h).toBeCloseTo(rect.h);
    // Seam within middle ±5% of the rect width.
    const seamRel = (right.x - rect.x) / rect.w;
    expect(seamRel).toBeGreaterThanOrEqual(LOOK_RATIO - MAX_DIST_RATIO / 2 - 0.01);
    expect(seamRel).toBeLessThanOrEqual(LOOK_RATIO + MAX_DIST_RATIO / 2 + 0.01);
    // Both halves are non-trivial.
    expect(left.w).toBeGreaterThan(0);
    expect(right.w).toBeGreaterThan(0);
  });
});

describe("splitRow", () => {
  it("splits near the vertical middle and overlaps the two halves", () => {
    const img = makeImage(10, 100, 255);
    const rect = { x: 2, y: 10, w: 6, h: 80 };
    const [top, bottom] = splitRow(img, rect);

    // Top half starts at the rect's top; bottom half ends at its bottom.
    expect(top.y).toBe(rect.y);
    expect(bottom.y + bottom.h).toBeCloseTo(rect.y + rect.h);
    // Width and x preserved.
    expect(top.x).toBe(rect.x);
    expect(top.w).toBeCloseTo(rect.w);
    expect(bottom.x).toBe(rect.x);
    expect(bottom.w).toBeCloseTo(rect.w);

    // The halves share a sliver of 2 * ROW_OVERLAP_RATIO * h (each extends
    // ROW_OVERLAP_RATIO past the seam, matching Briss's splitRow).
    const overlap = top.y + top.h - bottom.y;
    expect(overlap).toBeCloseTo(2 * ROW_OVERLAP_RATIO * rect.h, 5);
    expect(overlap).toBeGreaterThan(0);

    // Seam within middle ±5% of the rect height.
    const seamRel = (bottom.y - rect.y) / rect.h;
    expect(seamRel).toBeGreaterThanOrEqual(LOOK_RATIO - MAX_DIST_RATIO / 2 - 0.01);
    expect(seamRel).toBeLessThanOrEqual(LOOK_RATIO + MAX_DIST_RATIO / 2 + 0.01);
  });

  it("respects a horizontal gutter near the middle", () => {
    // 10x100 image, flat gutter at rows 47-53.
    const img = makeImage(10, 100, 255);
    for (let y = 0; y < 47; y += 2) fillRow(img, y, 0);
    for (let y = 54; y < 100; y += 2) fillRow(img, y, 0);
    const [, bottom] = splitRow(img, { x: 0, y: 0, w: 10, h: 100 });
    // The seam (bottom.y, ignoring the tiny overlap) sits inside [45, 55).
    expect(bottom.y).toBeGreaterThanOrEqual(45 - ROW_OVERLAP_RATIO * 100);
    expect(bottom.y).toBeLessThanOrEqual(55);
  });
});
