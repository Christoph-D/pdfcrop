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
 * PDF as a byte array. Port of DocumentCropper.crop (two-pass: page
 * multiplication followed by CropBox/MediaBox assignment).
 *
 * Outlines are preserved only when every source page has exactly one crop rect
 * (no multiplication). Otherwise the outline is dropped because pdf-lib
 * cannot shift outline targets to follow multiplied pages.
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

  const outDoc = await PDFDocument.create();
  outDoc.setProducer("PDFCrop");
  outDoc.setCreator("PDFCrop");
  outDoc.setTitle(srcDoc.getTitle() ?? source.fileName);

  // Pass 1: multiply pages. Each source page is copied N times into the output
  // (where N = number of rects for that page). We track the output index of
  // the first copy of each source page so that we can map ratios to copies.
  const pages = srcDoc.getPages();
  let outputIndex = 0;
  const firstCopyIndex = new Map<number, number>();
  const copyRects: Array<{ outputIndex: number; pageNumber: number; ratiosIndex: number }> = [];
  for (let pn = 1; pn <= pages.length; pn++) {
    const ratios = ratiosPerPage.get(pn)!;
    const copied = await outDoc.copyPages(srcDoc, [pn - 1]);
    for (let r = 0; r < ratios.length; r++) {
      const copy = copied[0]!;
      outDoc.addPage(copy);
      if (r === 0) firstCopyIndex.set(pn, outputIndex);
      copyRects.push({ outputIndex, pageNumber: pn, ratiosIndex: r });
      outputIndex++;
    }
  }

  // Pass 2: set CropBox and MediaBox on each output page using the rotated,
  // page-local rotation of the ratios and the original page's box dimensions.
  for (const { outputIndex, pageNumber, ratiosIndex } of copyRects) {
    const outPage = outDoc.getPages()[outputIndex]!;
    const srcPage = pages[pageNumber - 1]!;
    const ratios = ratiosPerPage.get(pageNumber)![ratiosIndex]!;

    // pdf-lib reports width/height already rotation-adjusted via
    // getWidth/getHeight; the raw mediabox may be in pre-rotation space.
    // Counter-rotate the ratios to align with the un-rotated mediabox.
    const rotation = (((srcPage.getRotation().angle ?? 0) % 360) + 360) % 360 as 0 | 90 | 180 | 270;
    const rotated = rotateRatios(ratios, rotation);

    // Use the rotation-adjusted width/height as the basis box. This matches
    // what the user sees in the preview and is consistent with pdf-lib's
    // setCropBox / setMediaBox coordinate system on the rotated page.
    const basisW = srcPage.getWidth();
    const basisH = srcPage.getHeight();
    const box = ratiosToAbsoluteBox(rotated, basisW, basisH);

    outPage.setCropBox(box.x, box.y, box.w, box.h);
    outPage.setMediaBox(box.x, box.y, box.w, box.h);
  }

  // Outline policy: keep only when no multiplication occurred.
  if (!outlinePreserved) {
    try {
      // pdf-lib doesn't expose deleteOutlines directly; reach into the catalog.
      const catalog = outDoc.catalog as unknown as { delete: (k: string) => void };
      catalog.delete("Outlines");
    } catch {
      // some PDFs have no outline tree; ignore
    }
  }

  const bytes = await outDoc.save({ useObjectStreams: true });
  return {
    bytes,
    outlinePreserved,
    outputPageCount: outputIndex,
  };
}

/** Build a default output filename: <basename>_cropped.pdf */
export function croppedFileName(original: string): string {
  const dot = original.lastIndexOf(".");
  const stem = dot > 0 ? original.slice(0, dot) : original;
  return `${stem}_cropped.pdf`;
}
