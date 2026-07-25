import type { PixelRect } from "./ratios";

/**
 * Split a crop rectangle into two equal-sized halves at its exact midpoint.
 *
 * The context-menu "Split row" / "Split column" actions (see `ClusterPanel`)
 * promise two equal halves, so — unlike the Briss port they replaced — these
 * cut at the geometric centre rather than searching a ±5% window for a
 * minimum-content-variance seam. The two halves always tile the original rect
 * exactly: no gaps, no overlap.
 */

/**
 * Replace `rect` with two equal-width halves by cutting at its horizontal
 * midpoint. Heights and y are preserved; the halves tile the rect exactly.
 */
export function splitColumn(rect: PixelRect): [PixelRect, PixelRect] {
  const halfW = rect.w / 2;
  const left: PixelRect = { x: rect.x, y: rect.y, w: halfW, h: rect.h };
  const right: PixelRect = { x: rect.x + halfW, y: rect.y, w: halfW, h: rect.h };
  return [left, right];
}

/**
 * Replace `rect` with two equal-height halves by cutting at its vertical
 * midpoint. Widths and x are preserved; the halves tile the rect exactly.
 */
export function splitRow(rect: PixelRect): [PixelRect, PixelRect] {
  const halfH = rect.h / 2;
  const top: PixelRect = { x: rect.x, y: rect.y, w: rect.w, h: halfH };
  const bottom: PixelRect = { x: rect.x, y: rect.y + halfH, w: rect.w, h: halfH };
  return [top, bottom];
}
