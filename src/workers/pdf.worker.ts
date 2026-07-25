/// <reference lib="webworker" />
import * as Comlink from "comlink";
import * as pdfjsLib from "pdfjs-dist";
// Importing the worker module populates `globalThis.pdfjsWorker`, which lets
// pdf.js run in-thread inside this Comlink worker (see `_setupFakeWorkerGlobal`
// + `disableWorker` below) without needing a `workerSrc`.
import "pdfjs-dist/build/pdf.worker.mjs";
import { calculateOverlay, type GrayImage, MAX_PAGE_HEIGHT } from "@/lib/pdf/overlay";

// pdf.js inside a worker: disable its own nested worker, run in-thread.
// `document` is undefined here, so pdf.js's default DOMCanvasFactory /
// DOMFilterFactory (which call `document.createElement(...)`) crash with
// "Cannot read properties of undefined (reading 'createElement')". Supply
// OffscreenCanvas-based replacements.

/**
 * Canvas factory backed by `OffscreenCanvas` (available in Web Workers),
 * replacing pdf.js's `DOMCanvasFactory` which needs `document`.
 */
class WorkerCanvasFactory {
  create(width: number, height: number) {
    if (width <= 0 || height <= 0) {
      throw new Error("Invalid canvas size");
    }
    const canvas = new OffscreenCanvas(width, height);
    return {
      canvas,
      context: canvas.getContext("2d", { willReadFrequently: true }),
    };
  }
  reset(canvasAndContext: { canvas: OffscreenCanvas }, width: number, height: number) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext: { canvas: OffscreenCanvas }) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
  _createCanvas(width: number, height: number): OffscreenCanvas {
    return new OffscreenCanvas(width, height);
  }
}

/**
 * No-op filter factory mirroring pdf.js's `BaseFilterFactory`. The default
 * `DOMFilterFactory` builds SVG `<defs>` via `document`, which is unavailable
 * in a worker; returning "none" is correct for plain page rasterization.
 */
class WorkerFilterFactory {
  addFilter(): string {
    return "none";
  }
  addHCMFilter(): string {
    return "none";
  }
  addAlphaFilter(): string {
    return "none";
  }
  addLuminosityFilter(): string {
    return "none";
  }
  addHighlightHCMFilter(): string {
    return "none";
  }
  destroy(): void {}
}

// Worker-context canvas/filter/font plumbing for pdf.js (see file header).
const getDocDefaults = {
  isEvalSupported: false,
  disableWorker: true,
  CanvasFactory: WorkerCanvasFactory,
  FilterFactory: WorkerFilterFactory,
  // This thread has no `document`, so the Font Loading API
  // (`isFontLoadingAPISupported` = `!!document.fonts`) is unavailable and
  // `@font-face` rules can't be inserted. `disableFontFace` makes pdf.js draw
  // each glyph as a path from the font's own outlines instead of via
  // `ctx.fillText`. `useSystemFonts` must be false too: with it true pdf.js
  // skips fetching standard-font data (returning null) and tries to register a
  // system font (`loadSystemFont`), which hits pdf.js's `unreachable(...)
  // branch (no Font Loading API in this thread) and leaves glyphs as blank
  // boxes. Together these force pdf.js to fetch the real standard-font data
  // (e.g. LiberationSans-*.ttf) from `standardFontDataUrl` and render its
  // outlines.
  disableFontFace: true,
  useSystemFonts: false,
} as const;

export interface RenderRequest {
  data: ArrayBuffer | Uint8Array;
  pageNumber: number;
  targetHeight?: number;
  /** Absolute URL prefix (trailing slash) for pdf.js standard fonts. */
  standardFontDataUrl?: string;
  /** Absolute URL prefix (trailing slash) for packed pdf.js CMaps. */
  cMapUrl?: string;
}

export interface RenderedPage {
  pageNumber: number;
  image: GrayImage;
}

export interface OverlayResult {
  clusterId: string;
  preview: GrayImage;
}

async function renderPage(req: RenderRequest): Promise<RenderedPage> {
  const targetHeight = req.targetHeight ?? MAX_PAGE_HEIGHT;
  const doc = await pdfjsLib.getDocument({
    data: req.data,
    ...getDocDefaults,
    // Required for non-embedded standard fonts and named-CMap CID fonts;
    // without them those glyphs render as blank boxes.
    standardFontDataUrl: req.standardFontDataUrl,
    cMapUrl: req.cMapUrl,
    cMapPacked: true,
    // Fetch CMaps/standard fonts in-thread. Left to its default, pdf.js would
    // evaluate `document.baseURI` while computing `useWorkerFetch`, but
    // `document` is undefined in this worker (it would throw). Setting it
    // explicitly short-circuits that and delivers the URLs to the worker's
    // evaluator, which fetches them with `fetch()`.
    useWorkerFetch: true,
  }).promise;
  const page = await doc.getPage(req.pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = targetHeight / baseViewport.height;
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.round(viewport.width));
  const height = Math.max(1, Math.round(viewport.height));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  await page.render({
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
    background: "white",
  }).promise;
  const img = ctx.getImageData(0, 0, width, height);
  const gray = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < img.data.length; i += 4, j++) {
    gray[j] = (img.data[i]! * 0.299 + img.data[i + 1]! * 0.587 + img.data[i + 2]! * 0.114) | 0;
  }
  await doc.destroy();
  return { pageNumber: req.pageNumber, image: { width, height, data: gray } };
}

async function computeClusterOverlay(clusterId: string, pages: RenderedPage[]): Promise<OverlayResult | null> {
  const preview = calculateOverlay(pages.map((p) => p.image));
  if (!preview) return null;
  return { clusterId, preview };
}

const api = { renderPage, computeClusterOverlay };
Comlink.expose(api);

export type PdfWorkerApi = typeof api;
