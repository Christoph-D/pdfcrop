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

const getDocDefaults = {
  isEvalSupported: false,
  disableWorker: true,
  CanvasFactory: WorkerCanvasFactory,
  FilterFactory: WorkerFilterFactory,
} as const;

export interface RenderRequest {
  data: ArrayBuffer | Uint8Array;
  password?: string;
  pageNumber: number;
  targetHeight?: number;
}

export interface RenderedPage {
  pageNumber: number;
  image: GrayImage;
}

export interface OverlayResult {
  clusterId: string;
  preview: GrayImage;
}

const docCache = new Map<string, pdfjsLib.PDFDocumentProxy>();

async function getDoc(key: string, data: ArrayBuffer | Uint8Array, password?: string) {
  let doc = docCache.get(key);
  if (doc) return doc;
  doc = await pdfjsLib.getDocument({ data, password, ...getDocDefaults }).promise;
  docCache.set(key, doc);
  return doc;
}

async function renderPage(req: RenderRequest): Promise<RenderedPage> {
  const targetHeight = req.targetHeight ?? MAX_PAGE_HEIGHT;
  const docKey = `doc-${req.data.byteLength}`;
  const doc = await getDoc(docKey, req.data, req.password);
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
  page.cleanup();
  return { pageNumber: req.pageNumber, image: { width, height, data: gray } };
}

async function computeClusterOverlay(clusterId: string, pages: RenderedPage[]): Promise<OverlayResult | null> {
  const preview = calculateOverlay(pages.map((p) => p.image));
  if (!preview) return null;
  return { clusterId, preview };
}

async function dispose(): Promise<void> {
  for (const doc of docCache.values()) await doc.destroy();
  docCache.clear();
}

const api = { renderPage, computeClusterOverlay, dispose };
Comlink.expose(api);

export type PdfWorkerApi = typeof api;
