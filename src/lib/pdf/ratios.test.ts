import { describe, expect, it } from "vitest";
import {
  pixelRectToRatios,
  rotateRatios,
  ratiosToAbsoluteBox,
  clamp,
} from "./ratios";

describe("clamp", () => {
  it("clamps within range", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

describe("pixelRectToRatios", () => {
  it("converts a centered rect to symmetric margins", () => {
    // 100x200 image, rect (10, 20, 80, 160) -> covers x:[10..90], y:[20..180]
    const r = pixelRectToRatios({ x: 10, y: 20, w: 80, h: 160 }, 100, 200);
    expect(r[0]).toBeCloseTo(0.1); // left
    expect(r[1]).toBeCloseTo(0.1); // bottom = (200-180)/200
    expect(r[2]).toBeCloseTo(0.1); // right = 1 - 90/100
    expect(r[3]).toBeCloseTo(0.1); // top = 1 - (200-20)/200 = 1 - 0.9 = 0.1
  });

  it("clamps out-of-bounds rects", () => {
    const r = pixelRectToRatios({ x: -10, y: -10, w: 200, h: 300 }, 100, 200);
    expect(r[0]).toBe(0);
    expect(r[1]).toBe(0);
    expect(r[2]).toBe(0);
    expect(r[3]).toBe(0);
  });
});

describe("rotateRatios", () => {
  it("returns the input for 0 rotation", () => {
    const r = pixelRectToRatios({ x: 10, y: 20, w: 30, h: 40 }, 100, 100);
    expect(rotateRatios(r, 0)).toEqual(r);
  });

  it("shifts tuple by one position per 90deg", () => {
    const r: [number, number, number, number] = [0.1, 0.2, 0.3, 0.4];
    expect(rotateRatios(r, 90)).toEqual([0.2, 0.3, 0.4, 0.1]);
    expect(rotateRatios(r, 180)).toEqual([0.3, 0.4, 0.1, 0.2]);
    expect(rotateRatios(r, 270)).toEqual([0.4, 0.1, 0.2, 0.3]);
    expect(rotateRatios(r, 0)).toEqual(r);
  });
});

describe("ratiosToAbsoluteBox", () => {
  it("converts ratios to absolute box coordinates", () => {
    const box = ratiosToAbsoluteBox([0.1, 0.2, 0.1, 0.2], 100, 200);
    expect(box.x).toBeCloseTo(10); // 0.1 * 100
    expect(box.y).toBeCloseTo(40); // 0.2 * 200
    expect(box.w).toBeCloseTo(80); // (1 - 0.2) * 100
    expect(box.h).toBeCloseTo(120); // (1 - 0.4) * 200
  });
});
