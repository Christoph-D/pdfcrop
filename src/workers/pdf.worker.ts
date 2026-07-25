/// <reference lib="webworker" />
import * as Comlink from "comlink";
import { calculateOverlay, type GrayImage } from "@/lib/pdf/overlay";

// This worker used to host pdf.js itself (rasterizing pages in-thread via the
// pdf.js "fake worker"). That deadlocked in Firefox the moment a second
// `page.render()` was issued on the same document — large PDFs (many pages per
// pooled worker) hung forever at "Rendering previews… 0/N", and even a single
// worker stalled after its first page. Chrome was unaffected, and the Firefox
// failure was dev-server-only (production builds worked), which is why it went
// unnoticed with a Chromium-only E2E suite.
//
// pdf.js rendering now runs on the main thread (where pdf.js already has a
// real worker via `GlobalWorkerOptions.workerPort`, the standard path that
// Firefox is happy with). This worker is kept only for the CPU-intensive,
// pdf.js-independent work: merging a cluster's page images into one preview.

async function computeClusterOverlay(images: GrayImage[]): Promise<GrayImage | null> {
  return calculateOverlay(images);
}

const api = { computeClusterOverlay };
Comlink.expose(api);

export type PdfWorkerApi = typeof api;
