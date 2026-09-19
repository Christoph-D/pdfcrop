import * as Comlink from "comlink";
import * as pdfjsLib from "pdfjs-dist";
import type { Cluster } from "./cluster";
import type { GrayImage } from "./overlay";
import { MAX_PAGE_HEIGHT } from "./overlay";
import type { PdfWorkerApi } from "@/workers/pdf.worker";

export interface ClusterPreview {
  clusterId: string;
  preview: GrayImage;
  previewUrl: string;
}

/**
 * How many pages to rasterize at once. pdf.js offloads the actual rasterization
 * to its own worker, so the main thread here only coordinates renders and reads
 * back pixels; a small amount of overlap keeps large PDFs progressing without
 * flooding the main thread.
 */
const RENDER_CONCURRENCY = 4;

function createOverlayWorker(): { api: PdfWorkerApi; terminate: () => void } {
  const worker = new Worker(new URL("../../workers/pdf.worker.ts", import.meta.url), {
    type: "module",
  });
  return { api: Comlink.wrap<PdfWorkerApi>(worker), terminate: () => worker.terminate() };
}

/** Rasterize one page to a grayscale image at most `MAX_PAGE_HEIGHT` tall. */
async function renderPageToGray(doc: pdfjsLib.PDFDocumentProxy, pageNumber: number): Promise<GrayImage> {
  const page = await doc.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = MAX_PAGE_HEIGHT / baseViewport.height;
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.round(viewport.width));
  const height = Math.max(1, Math.round(viewport.height));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  await page.render({
    canvas,
    viewport,
    background: "white",
  }).promise;
  const img = ctx.getImageData(0, 0, width, height);
  const gray = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < img.data.length; i += 4, j++) {
    gray[j] = (img.data[i]! * 0.299 + img.data[i + 1]! * 0.587 + img.data[i + 2]! * 0.114) | 0;
  }
  // Release this page's cached resources; the document itself stays open for
  // the next render.
  page.cleanup();
  return { width, height, data: gray };
}

/**
 * Renders the sampled pages for each cluster and computes a merged preview.
 *
 * Rasterization runs on the main thread through pdf.js's own worker (the
 * standard, browser-portable path). The per-cluster overlay math — the
 * genuinely CPU-heavy, pdf.js-independent step — is dispatched to a Web Worker
 * so it never blocks the UI. Progress is reported as pages complete (0..1).
 */
export async function renderClusterPreviews(
  data: ArrayBuffer,
  clusters: Cluster[],
  onProgress?: (done: number, total: number) => void,
): Promise<ClusterPreview[]> {
  const jobs = clusters.flatMap((cluster) => cluster.pagesToMerge.map((pageNumber) => ({ cluster, pageNumber })));
  if (jobs.length === 0) return [];

  // Resolve BASE_URL against the document: with the relative base ("./") a
  // raw "./standard_fonts/" would resolve against the page's assets/ path
  // instead of the app root.
  const assetBase = new URL(import.meta.env.BASE_URL, document.baseURI).href;
  const loadingTask = pdfjsLib.getDocument({
    data: data.slice(0),
    // Required for non-embedded standard fonts and named-CMap CID fonts;
    // without them those glyphs render as blank boxes.
    standardFontDataUrl: `${assetBase}standard_fonts/`,
    cMapUrl: `${assetBase}cmaps/`,
    cMapPacked: true,
    // Draw glyphs as outlines from the fetched standard-font programs instead
    // of relying on the Font Loading API / system fonts. Headless browsers
    // (and environments without the base-14 fonts) otherwise render
    // non-embedded fonts (Helvetica, ...) as blank .notdef boxes.
    disableFontFace: true,
    useSystemFonts: false,
  });
  const doc = await loadingTask.promise;

  const overlay = createOverlayWorker();
  try {
    const total = jobs.length;
    let done = 0;
    const grayByCluster = new Map<string, GrayImage[]>();
    for (const cluster of clusters) grayByCluster.set(cluster.id, []);

    // Render pages with bounded concurrency. pdf.js's worker does the heavy
    // rasterization; the main thread only drives renders and reads back pixels,
    // so a few in flight is enough to keep things moving without jank.
    let cursor = 0;
    const renderers = Array.from({ length: Math.min(RENDER_CONCURRENCY, jobs.length) }, async () => {
      while (cursor < jobs.length) {
        const index = cursor++;
        const { cluster, pageNumber } = jobs[index]!;
        const gray = await renderPageToGray(doc, pageNumber);
        grayByCluster.get(cluster.id)!.push(gray);
        done += 1;
        onProgress?.(done, total);
      }
    });
    await Promise.all(renderers);

    // Merge each cluster's pages into one preview in the worker (off the main
    // thread). calculateOverlay is order-independent, so the order pages landed
    // in the array above doesn't matter.
    const previews = await Promise.all(
      clusters.map(async (cluster): Promise<ClusterPreview> => {
        const images = grayByCluster.get(cluster.id) ?? [];
        const preview = (await overlay.api.computeClusterOverlay(images)) ?? {
          width: 1,
          height: 1,
          data: new Uint8Array([255]),
        };
        return {
          clusterId: cluster.id,
          preview,
          previewUrl: grayToDataUrl(preview),
        };
      }),
    );

    return previews;
  } finally {
    overlay.terminate();
    await loadingTask.destroy();
  }
}

function grayToDataUrl(gray: GrayImage): string {
  const canvas = document.createElement("canvas");
  canvas.width = gray.width;
  canvas.height = gray.height;
  const ctx = canvas.getContext("2d")!;
  const rgba = new Uint8ClampedArray(gray.width * gray.height * 4);
  for (let i = 0, j = 0; i < gray.data.length; i++, j += 4) {
    const v = gray.data[i]!;
    rgba[j] = v;
    rgba[j + 1] = v;
    rgba[j + 2] = v;
    rgba[j + 3] = 255;
  }
  const imgData = ctx.createImageData(gray.width, gray.height);
  imgData.data.set(rgba);
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL("image/png");
}
