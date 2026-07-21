import * as pdfjsLib from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
import type { PageMetadata, PdfSource, Rotation } from "./types";

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

export class PasswordRequiredError extends Error {
  constructor() {
    super("Password required");
    this.name = "PasswordRequiredError";
  }
}

export class InvalidPasswordError extends Error {
  constructor() {
    super("Invalid password");
    this.name = "InvalidPasswordError";
  }
}

export class CorruptPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorruptPdfError";
  }
}

function normalizeRotation(r: number | undefined): Rotation {
  const v = ((r ?? 0) % 360 + 360) % 360;
  if (v === 0 || v === 90 || v === 180 || v === 270) return v;
  return 0;
}

export async function loadPdf(
  data: ArrayBuffer,
  fileName: string,
  password?: string,
): Promise<PdfSource> {
  let doc: pdfjsLib.PDFDocumentProxy;
  try {
    // pdf.js transfers (and detaches) the ArrayBuffer it receives into its
    // worker. Give it a copy so the caller's buffer remains usable for later
    // rendering/cropping passes.
    doc = await pdfjsLib.getDocument({
      data: data.slice(0),
      password,
      isEvalSupported: false,
    }).promise;
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e.name === "PasswordException") {
      if (e.message === "Incorrect password") {
        throw new InvalidPasswordError();
      }
      throw new PasswordRequiredError();
    }
    if (e.name === "InvalidPDFException") {
      throw new CorruptPdfError(e.message ?? "Invalid PDF");
    }
    throw err;
  }

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
}

export type { pdfjsLib };
