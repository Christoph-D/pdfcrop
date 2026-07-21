import type { Rotation } from "./types";

/** Margin ratios [left, bottom, right, top] with PDF bottom-left origin, 0..1 each. */
export type Ratios = readonly [number, number, number, number];

/** Image-space rect in pixels (top-left origin). */
export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const CORNER_DIMENSION = 8;
export const SELECTABLE_CORNER_DIMENSION = 20;
export const EDGE_THRESHOLD = 5;
export const MIN_SIZE_FOR_HANDLES = 2 * CORNER_DIMENSION;

/**
 * Convert a pixel-space rect to PDF margin ratios.
 * Port of MergedPanel.getCutRatiosForPdf.
 */
export function pixelRectToRatios(rect: PixelRect, imgW: number, imgH: number): Ratios {
  const x1 = clamp(rect.x, 0, imgW);
  const y1 = clamp(rect.y, 0, imgH);
  const x2 = clamp(rect.x + rect.w, 0, imgW);
  const y2 = clamp(rect.y + rect.h, 0, imgH);
  const left = x1 / imgW;
  const right = 1 - x2 / imgW;
  const top = y1 / imgH;
  const bottom = (imgH - y2) / imgH;
  return [left, bottom, right, top];
}

/**
 * Inverse of `pixelRectToRatios`. Converts PDF margin ratios back to a
 * pixel-space rect in image (top-left origin) coordinates.
 */
export function ratiosToPixelRect(
  ratios: Ratios,
  imgW: number,
  imgH: number,
): PixelRect {
  const [left, bottom, right, top] = ratios;
  const x1 = left * imgW;
  const x2 = (1 - right) * imgW;
  const y1 = top * imgH;
  const y2 = (1 - bottom) * imgH;
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Rotate ratios counter-clockwise to align with an un-rotated page.
 * Port of RectangleHandler.rotateRatios. Each +90deg rotation shifts
 * (L, B, R, T) -> (B, R, T, L).
 */
export function rotateRatios(ratios: Ratios, rotation: Rotation): Ratios {
  let [a, b, c, d] = ratios;
  const steps = (((rotation ?? 0) % 360) + 360) % 360 / 90;
  for (let i = 0; i < steps; i++) {
    [a, b, c, d] = [b, c, d, a];
  }
  return [a, b, c, d];
}

/**
 * Convert PDF margin ratios to absolute page coordinates given a page box.
 * Port of RectangleHandler.calculateScaledRectangle, simplified for our use
 * (we use the same box for cropbox and mediabox, and assume the basis box
 * starts at the origin).
 */
export function ratiosToAbsoluteBox(
  ratios: Ratios,
  boxWidth: number,
  boxHeight: number,
): { x: number; y: number; w: number; h: number } {
  const [left, bottom, right, top] = ratios;
  const x = left * boxWidth;
  const y = bottom * boxHeight;
  const w = Math.max(0, (1 - left - right) * boxWidth);
  const h = Math.max(0, (1 - top - bottom) * boxHeight);
  return { x, y, w, h };
}

export function hasEnoughSpaceForHandles(rect: PixelRect): boolean {
  return rect.w >= MIN_SIZE_FOR_HANDLES && rect.h >= MIN_SIZE_FOR_HANDLES;
}
