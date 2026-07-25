import { describe, expect, it } from "vitest";
import { formatCropSizeLabel, INCH_IN_MILLIMETERS, INCH_IN_USER_UNIT } from "./units";

describe("formatCropSizeLabel", () => {
  it("exposes the DrawableCropRect conversion constants", () => {
    expect(INCH_IN_USER_UNIT).toBe(72);
    expect(INCH_IN_MILLIMETERS).toBe(25.4);
  });

  it("formats a square rect as WxH mm with a 1:1 ratio", () => {
    // 72 preview-px == 1 inch == 25.4 mm on both axes.
    expect(formatCropSizeLabel({ x: 0, y: 0, w: 72, h: 72 })).toBe("25x25 mm  1:1.00");
  });

  it("uses the longer side for the ratio and reports millimeters", () => {
    // w = round(25.4 * 144 / 72) = round(50.8) = 51
    // h = round(25.4 * 72 / 72)  = 25
    // ratio = 51/25 = 2.04
    expect(formatCropSizeLabel({ x: 0, y: 0, w: 144, h: 72 })).toBe("51x25 mm  1:2.04");
  });

  it("inverts the ratio when the rect is taller than wide", () => {
    expect(formatCropSizeLabel({ x: 0, y: 0, w: 72, h: 144 })).toBe("25x51 mm  1:2.04");
  });

  it("omits the ratio when either dimension rounds to zero", () => {
    expect(formatCropSizeLabel({ x: 0, y: 0, w: 0, h: 72 })).toBe("0x25 mm");
    expect(formatCropSizeLabel({ x: 0, y: 0, w: 72, h: 0 })).toBe("25x0 mm");
  });
});
