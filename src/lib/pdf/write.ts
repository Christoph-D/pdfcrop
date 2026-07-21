import { PDFDocument } from "pdf-lib";
import type { Cluster } from "./cluster";
import {
  pixelRectToRatios,
  ratiosToAbsoluteBox,
  rotateRatios,
  type Ratios,
} from "./ratios";
import type { PdfSource } from "./types";
import type { CropRect } from "@/store/cropStore";

export interface CropInput {
  source: PdfSource;
  password: string | null;
  clusters: Cluster[];
  rectsByCluster: Record<string, CropRect[]>;
  previews: { clusterId: string; preview: { width: number; height: number } }[];
}

export interface CropOutput {
  bytes: Uint8Array;
  outlinePreserved: boolean;
  outputPageCount: number;
}

/**
 * Apply user-drawn crop rectangles to the source PDF, producing a new cropped
 * PDF as a byte array. Port of DocumentCropper.crop.
 *
 * Two strategies:
 *  - No multiplication (every page has ≤1 crop rect): the source document is
 *    modified in place and saved. This preserves all catalog-level metadata
 *    pdf-lib's `copyPages` cannot carry over — outlines/bookmarks, the Names
 *    tree (named destinations the outline resolves to), PageLabels, and
 *    OpenAction.
 *  - Multiplication (some page has >1 crop rect): a fresh output document is
 *    built by copying each source page N times, then assigning CropBox /
 *    MediaBox. The outline tree is dropped in this case because pdf-lib
 *    cannot shift outline destinations to follow multiplied pages.
 */
export async function cropPdf(input: CropInput): Promise<CropOutput> {
  const { source, clusters, rectsByCluster, previews } = input;

  // Build a per-page list of ratios (in PDF coordinates) by expanding each
  // cluster's rectangles over every page it owns.
  const previewByCluster = new Map(
    previews.map((p) => [p.clusterId, p.preview]),
  );
  const clusterByPageNumber = new Map<number, Cluster>();
  for (const cluster of clusters) {
    for (const pageNumber of cluster.allPages) {
      clusterByPageNumber.set(pageNumber, cluster);
    }
  }

  const ratiosPerPage = new Map<number, Ratios[]>();
  let maxRectsPerPage = 0;
  for (let pn = 1; pn <= source.pages.length; pn++) {
    const cluster = clusterByPageNumber.get(pn);
    if (!cluster) {
      ratiosPerPage.set(pn, [[0, 0, 0, 0]] as Ratios[]);
      continue;
    }
    const preview = previewByCluster.get(cluster.id)!;
    const drawn = rectsByCluster[cluster.id] ?? [];
    const ratios = drawn.map((r) =>
      pixelRectToRatios(r, preview.width, preview.height),
    );
    const list: Ratios[] = ratios.length > 0 ? ratios : [[0, 0, 0, 0]];
    ratiosPerPage.set(pn, list);
    if (list.length > maxRectsPerPage) maxRectsPerPage = list.length;
  }

  const outlinePreserved = maxRectsPerPage <= 1;

  // Load the source via pdf-lib. If the source is encrypted, pdf-lib can load
  // it only when the password is supplied (or it is empty); otherwise the
  // caller should pass decrypted bytes.
  const srcDoc = await PDFDocument.load(source.data, {
    ignoreEncryption: true,
  });
  srcDoc.setProducer("PDFCrop");
  srcDoc.setCreator("PDFCrop");
  if (!srcDoc.getTitle()) srcDoc.setTitle(source.fileName);

  if (outlinePreserved) {
    // In-place path: edit each page's CropBox/MediaBox on srcDoc. All
    // catalog metadata (Outlines, Names, PageLabels, OpenAction) survives
    // because we never leave the source document.
    const pages = srcDoc.getPages();
    for (let pn = 1; pn <= pages.length; pn++) {
      const ratios = ratiosPerPage.get(pn)![0]!;
      applyCrop(pages[pn - 1]!, ratios);
    }
    const bytes = await srcDoc.save({ useObjectStreams: true });
    return { bytes, outlinePreserved: true, outputPageCount: pages.length };
  }

  // Multiplication path. Pass 1: copy each source page N times into a fresh
  // output document (N = number of rects for that page). We track the output
  // index of each copy so we can map ratios to copies in pass 2.
  const outDoc = await PDFDocument.create();
  outDoc.setProducer("PDFCrop");
  outDoc.setCreator("PDFCrop");
  outDoc.setTitle(srcDoc.getTitle() ?? source.fileName);

  const pages = srcDoc.getPages();
  let outputIndex = 0;
  const copyRects: Array<{ outputIndex: number; pageNumber: number; ratiosIndex: number }> = [];
  for (let pn = 1; pn <= pages.length; pn++) {
    const ratios = ratiosPerPage.get(pn)!;
    const copied = await outDoc.copyPages(srcDoc, [pn - 1]);
    for (let r = 0; r < ratios.length; r++) {
      const copy = copied[0]!;
      outDoc.addPage(copy);
      copyRects.push({ outputIndex, pageNumber: pn, ratiosIndex: r });
      outputIndex++;
    }
  }

  // Pass 2: set CropBox and MediaBox on each output page.
  for (const { outputIndex, pageNumber, ratiosIndex } of copyRects) {
    const outPage = outDoc.getPages()[outputIndex]!;
    const ratios = ratiosPerPage.get(pageNumber)![ratiosIndex]!;
    applyCrop(outPage, ratios);
  }

  // Outline policy: drop when multiplication occurred (destinations can no
  // longer be remapped reliably).
  try {
    // pdf-lib doesn't expose deleteOutlines directly; reach into the catalog.
    const catalog = outDoc.catalog as unknown as { delete: (k: string) => void };
    catalog.delete("Outlines");
  } catch {
    // some PDFs have no outline tree; ignore
  }

  const bytes = await outDoc.save({ useObjectStreams: true });
  return { bytes, outlinePreserved: false, outputPageCount: outputIndex };
}

/**
 * Set CropBox and MediaBox on a page from PDF margin ratios. Counter-rotates
 * the ratios to align with the un-rotated mediabox, then uses the rotation-
 * adjusted width/height as the basis box (matches what the user sees in the
 * preview and is consistent with pdf-lib's box setters on rotated pages).
 */
function applyCrop(page: ReturnType<PDFDocument["getPages"]>[number], ratios: Ratios): void {
  const rotation = (((page.getRotation().angle ?? 0) % 360) + 360) % 360 as 0 | 90 | 180 | 270;
  const rotated = rotateRatios(ratios, rotation);
  const basisW = page.getWidth();
  const basisH = page.getHeight();
  const box = ratiosToAbsoluteBox(rotated, basisW, basisH);
  page.setCropBox(box.x, box.y, box.w, box.h);
  page.setMediaBox(box.x, box.y, box.w, box.h);
}

/** Build a default output filename: <basename>_cropped.pdf */
export function croppedFileName(original: string): string {
  const dot = original.lastIndexOf(".");
  const stem = dot > 0 ? original.slice(0, dot) : original;
  return `${stem}_cropped.pdf`;
}
