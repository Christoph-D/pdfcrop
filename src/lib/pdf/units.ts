import type { PixelRect } from "./ratios";

/**
 * A PDF default user-space unit is a point: 72 points per inch.
 * Port of `DrawableCropRect.INCH_IN_USER_UNIT`.
 */
export const INCH_IN_USER_UNIT = 72;

/**
 * Millimeters per inch.
 * Port of `DrawableCropRect.INCH_IN_MILLIMETERS`.
 */
export const INCH_IN_MILLIMETERS = 25.4;

/**
 * Format the size label Briss draws on selected crop rects:
 * `WxH mm  1:ratio`, where `W` and `H` are the rect's size in millimeters
 * (rounded) and the ratio is the longer side over the shorter side.
 *
 * Port of `DrawableCropRect.drawSelectionOverlay`. As in Briss, the
 * crop-rect coordinates live in the merged-preview pixel space, which is
 * rendered at the same scale relative to PDF points (the preview is merged
 * down to a fixed height). Applying `mm = INCH_IN_MILLIMETERS * px /
 * INCH_IN_USER_UNIT` directly to those pixels reproduces Briss's label.
 */
export function formatCropSizeLabel(rect: PixelRect): string {
  const w = Math.round((INCH_IN_MILLIMETERS * rect.w) / INCH_IN_USER_UNIT);
  const h = Math.round((INCH_IN_MILLIMETERS * rect.h) / INCH_IN_USER_UNIT);
  let label = `${w}x${h} mm`;
  if (w > 0 && h > 0) {
    let ratio = w / h;
    if (ratio < 1) ratio = 1 / ratio;
    label += `  1:${ratio.toFixed(2)}`;
  }
  return label;
}
