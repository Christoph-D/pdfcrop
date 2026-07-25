import { describe, expect, it } from "vitest";
import { splitColumn, splitRow } from "./split";

describe("splitColumn", () => {
  it("splits the rect into two equal-width halves that tile it exactly", () => {
    const rect = { x: 10, y: 5, w: 80, h: 6 };
    const [left, right] = splitColumn(rect);

    // Both halves have exactly half the width.
    expect(left.w).toBeCloseTo(rect.w / 2, 5);
    expect(right.w).toBeCloseTo(rect.w / 2, 5);

    // Heights and y preserved.
    expect(left.h).toBeCloseTo(rect.h);
    expect(right.h).toBeCloseTo(rect.h);
    expect(left.y).toBe(rect.y);
    expect(right.y).toBe(rect.y);

    // The halves tile the rect exactly: no gap, no overlap.
    expect(left.x).toBe(rect.x);
    expect(right.x).toBeCloseTo(rect.x + rect.w / 2, 5);
    expect(right.x + right.w).toBeCloseTo(rect.x + rect.w, 5);
    expect(right.x).toBeCloseTo(left.x + left.w, 5);
  });

  it("preserves x and y for an off-origin rect", () => {
    const rect = { x: 3, y: 7, w: 50, h: 20 };
    const [left, right] = splitColumn(rect);
    expect(left.x).toBe(3);
    expect(right.x).toBeCloseTo(28, 5);
    expect(left.y).toBe(7);
    expect(right.y).toBe(7);
    expect(left.h).toBeCloseTo(20);
    expect(right.h).toBeCloseTo(20);
  });
});

describe("splitRow", () => {
  it("splits the rect into two equal-height halves that tile it exactly", () => {
    const rect = { x: 2, y: 10, w: 6, h: 80 };
    const [top, bottom] = splitRow(rect);

    // Both halves have exactly half the height.
    expect(top.h).toBeCloseTo(rect.h / 2, 5);
    expect(bottom.h).toBeCloseTo(rect.h / 2, 5);

    // Widths and x preserved.
    expect(top.w).toBeCloseTo(rect.w);
    expect(bottom.w).toBeCloseTo(rect.w);
    expect(top.x).toBe(rect.x);
    expect(bottom.x).toBe(rect.x);

    // The halves tile the rect exactly: no gap, no overlap.
    expect(top.y).toBe(rect.y);
    expect(bottom.y).toBeCloseTo(rect.y + rect.h / 2, 5);
    expect(bottom.y + bottom.h).toBeCloseTo(rect.y + rect.h, 5);
    expect(bottom.y).toBeCloseTo(top.y + top.h, 5);
  });

  it("cuts at the exact midpoint regardless of content", () => {
    // Content is irrelevant now — the split is purely geometric.
    const rect = { x: 0, y: 0, w: 10, h: 100 };
    const [top, bottom] = splitRow(rect);
    expect(top.h).toBeCloseTo(50, 5);
    expect(bottom.h).toBeCloseTo(50, 5);
    expect(top.y).toBe(0);
    expect(bottom.y).toBeCloseTo(50, 5);
  });
});
