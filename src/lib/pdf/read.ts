import * as pdfjsLib from "pdfjs-dist";
// In production, Vite emits the worker script as an untouched asset. In dev we
// must NOT let Vite serve it through its module pipeline: the injected HMR
// client (`/@vite/client`, which opens a WebSocket inside the worker)
// deadlocks pdf.js rasterization in Firefox. The dev server instead serves the
// pristine file from `/pdf.worker.min.mjs` (see pdfjsStaticAssets in
// vite.config.ts).
import PdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PageMetadata, PdfSource, Rotation } from "./types";

pdfjsLib.GlobalWorkerOptions.workerSrc = import.meta.env.DEV ? "/pdf.worker.min.mjs" : PdfWorkerUrl;

export class EncryptedPdfError extends Error {
  constructor() {
    super("Encrypted PDFs are not supported");
    this.name = "EncryptedPdfError";
  }
}

export class CorruptPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorruptPdfError";
  }
}

function normalizeRotation(r: number | undefined): Rotation {
  const v = (((r ?? 0) % 360) + 360) % 360;
  if (v === 0 || v === 90 || v === 180 || v === 270) return v;
  return 0;
}

export async function loadPdf(data: ArrayBuffer, fileName: string): Promise<PdfSource> {
  // pdf.js transfers (and detaches) the ArrayBuffer it receives into its
  // worker. Give it a copy so the caller's buffer remains usable for later
  // rendering/cropping passes.
  const loadingTask = pdfjsLib.getDocument({ data: data.slice(0) });
  let doc: pdfjsLib.PDFDocumentProxy;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e.name === "PasswordException") {
      throw new EncryptedPdfError();
    }
    if (e.name === "InvalidPDFException") {
      throw new CorruptPdfError(e.message ?? "Invalid PDF");
    }
    throw err;
  }

  try {
    const pages: PageMetadata[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({
        pageNumber: i,
        width: viewport.width,
        height: viewport.height,
        rotation: normalizeRotation(page.rotate),
      });
      page.cleanup();
    }

    return {
      data,
      fileName,
      pages,
    };
  } finally {
    await loadingTask.destroy();
  }
}

export type { pdfjsLib };
