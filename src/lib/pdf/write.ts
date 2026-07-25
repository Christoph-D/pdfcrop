import { PDFDocument, PDFArray, PDFDict, PDFName, PDFRef, PDFStream, type PDFContext, type PDFObject } from "pdf-lib";
import type { Cluster } from "./cluster";
import { pixelRectToRatios, ratiosToAbsoluteBox, rotateRatios, type Ratios } from "./ratios";
import type { PdfSource } from "./types";
import type { CropRect } from "@/store/cropStore";

export interface CropInput {
  source: PdfSource;
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
 *    MediaBox. The outline (bookmark) tree is carried over and its page
 *    destinations are rewritten to point at the FIRST output copy of each
 *    original page — the pdf-lib equivalent of Briss's
 *    `SimpleBookmark.shiftPageNumbers` + `PdfStamper.setOutlines`.
 */
export async function cropPdf(input: CropInput): Promise<CropOutput> {
  const { source, clusters, rectsByCluster, previews } = input;

  // Build a per-page list of ratios (in PDF coordinates) by expanding each
  // cluster's rectangles over every page it owns.
  const previewByCluster = new Map(previews.map((p) => [p.clusterId, p.preview]));
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
    const ratios = drawn.map((r) => pixelRectToRatios(r, preview.width, preview.height));
    const list: Ratios[] = ratios.length > 0 ? ratios : [[0, 0, 0, 0]];
    ratiosPerPage.set(pn, list);
    if (list.length > maxRectsPerPage) maxRectsPerPage = list.length;
  }

  const outlinePreserved = maxRectsPerPage <= 1;

  // `ignoreEncryption: true` lets pdf-lib open PDFs that are marked as
  // encrypted but have an empty user password (pdf.js loads these without
  // prompting). PDFs that require an actual password are rejected upstream
  // in `loadPdf`.
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
  // Map each source page's object number to the ref of its first output copy.
  // Outline destinations are rewritten to these refs so bookmarks survive page
  // multiplication (see `copyOutlines`).
  const firstCopyRefBySrcPage = new Map<number, PDFRef>();
  for (let pn = 1; pn <= pages.length; pn++) {
    const ratios = ratiosPerPage.get(pn)!;
    const copied = await outDoc.copyPages(srcDoc, [pn - 1]);
    const srcPageRef = pages[pn - 1]!.ref;
    for (let r = 0; r < ratios.length; r++) {
      const copy = copied[0]!;
      outDoc.addPage(copy);
      if (r === 0) firstCopyRefBySrcPage.set(srcPageRef.objectNumber, copy.ref);
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

  // Carry the outline tree over to the output, rewriting every destination
  // page reference to the first output copy of the original page. Returns
  // false (after dropping the tree) if it could not be copied safely.
  const outlinesIntact = copyOutlines(srcDoc, outDoc, firstCopyRefBySrcPage);
  // Carry the source's named destinations too: many PDFs (Word, LaTeX, …)
  // specify outline destinations *by name*, resolved via the catalog's
  // `/Names /Dests` name tree. `copyPages` does not carry that tree over, so
  // without this every named-destination bookmark would point at a name that
  // no longer exists in the output and clicking it would jump nowhere.
  const namedDestsIntact = copyNamedDestinations(srcDoc, outDoc, firstCopyRefBySrcPage);

  const bytes = await outDoc.save({ useObjectStreams: true });
  return { bytes, outlinePreserved: outlinesIntact && namedDestsIntact, outputPageCount: outputIndex };
}

/**
 * Set CropBox and MediaBox on a page from PDF margin ratios. Counter-rotates
 * the ratios to align with the un-rotated mediabox, then uses the rotation-
 * adjusted width/height as the basis box (matches what the user sees in the
 * preview and is consistent with pdf-lib's box setters on rotated pages).
 */
function applyCrop(page: ReturnType<PDFDocument["getPages"]>[number], ratios: Ratios): void {
  const rotation = ((((page.getRotation().angle ?? 0) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
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

/**
 * Copy the source document's outline (bookmark) tree into the output document,
 * rewriting every destination page reference to point at the FIRST output
 * copy of the original page. This is the pdf-lib port of Briss's
 * `SimpleBookmark.shiftPageNumbers` (run after page duplication) followed by
 * `PdfStamper.setOutlines`.
 *
 * Returns `true` when the output's outline tree is intact — either the source
 * had no outlines, or they were copied successfully. Returns `false` (after
 * dropping the output's outline tree) if copying failed, so the caller can
 * warn the user that bookmarks were lost.
 */
function copyOutlines(srcDoc: PDFDocument, outDoc: PDFDocument, firstCopyRefBySrcPage: Map<number, PDFRef>): boolean {
  const outlinesValue = srcDoc.catalog.get(PDFName.of("Outlines"));
  if (!outlinesValue) return true; // nothing to preserve

  try {
    const cloned = cloneWithPageMap(
      outlinesValue,
      srcDoc.context,
      outDoc.context,
      firstCopyRefBySrcPage,
      new Map<number, PDFRef>(),
    );
    outDoc.catalog.set(PDFName.of("Outlines"), cloned);
    return true;
  } catch {
    // Could not safely rewrite outline destinations. Drop the tree so we still
    // emit a valid PDF, and signal that bookmarks were lost.
    outDoc.catalog.delete(PDFName.of("Outlines"));
    return false;
  }
}

/**
 * Copy the source document's named-destination tree (`catalog /Names /Dests`)
 * into the output, rewriting every destination page reference to the FIRST
 * output copy of the original page. Outline items that specify destinations
 * *by name* (common in PDFs exported from Word, LaTeX, etc.) reference a name
 * that `PDFDocument.copyPages` does not carry over; without this the name
 * dangles in the output and clicking the bookmark jumps nowhere.
 *
 * The destination arrays inside the name tree have the same `[pageRef …]`
 * shape as explicit outline destinations, so the same ref-rewriting walk used
 * for outlines (`cloneWithPageMap`) handles them. Returns `true` when there
 * was nothing to copy or the copy succeeded, `false` if it failed.
 */
function copyNamedDestinations(
  srcDoc: PDFDocument,
  outDoc: PDFDocument,
  firstCopyRefBySrcPage: Map<number, PDFRef>,
): boolean {
  const srcNames = srcDoc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  if (!srcNames) return true; // no Names tree -> nothing to carry
  const srcDests = srcNames.get(PDFName.of("Dests"));
  if (!srcDests) return true; // no named destinations

  try {
    const cloned = cloneWithPageMap(
      srcDests,
      srcDoc.context,
      outDoc.context,
      firstCopyRefBySrcPage,
      new Map<number, PDFRef>(),
    );
    let outNames = outDoc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
    if (!outNames) {
      outNames = PDFDict.withContext(outDoc.context);
      outDoc.catalog.set(PDFName.of("Names"), outNames);
    }
    outNames.set(PDFName.of("Dests"), cloned);
    return true;
  } catch {
    // Could not safely rewrite named destinations. Leave them uncopied; named-
    // destination bookmarks won't resolve, but the PDF stays valid.
    return false;
  }
}

/**
 * Deep-copy an object graph from the source context into the destination
 * context, rewriting page references via `pageMap` (source object number ->
 * first-copy output ref). Used for both the outline (bookmark) tree and the
 * named-destination (`/Names /Dests`) name tree, which share the same
 * `[pageRef …]` destination shape. `visited` breaks the cycles the outline
 * tree contains (every item links back to its `/Parent`, and `/First` links
 * down to children) and deduplicates shared indirect objects.
 */
function cloneWithPageMap(
  value: PDFObject,
  srcCtx: PDFContext,
  dstCtx: PDFContext,
  pageMap: Map<number, PDFRef>,
  visited: Map<number, PDFRef>,
): PDFObject {
  if (value instanceof PDFRef) {
    // A destination page reference -> retarget to the first output copy.
    const mapped = pageMap.get(value.objectNumber);
    if (mapped) return mapped;
    return cloneIndirect(value, srcCtx, dstCtx, pageMap, visited);
  }
  if (value instanceof PDFDict) {
    const clone = PDFDict.withContext(dstCtx);
    for (const [key, entry] of value.entries()) {
      clone.set(key, cloneWithPageMap(entry, srcCtx, dstCtx, pageMap, visited));
    }
    return clone;
  }
  if (value instanceof PDFArray) {
    const clone = PDFArray.withContext(dstCtx);
    for (let i = 0; i < value.size(); i++) {
      clone.push(cloneWithPageMap(value.get(i), srcCtx, dstCtx, pageMap, visited));
    }
    return clone;
  }
  if (value instanceof PDFStream) {
    // Outline/name trees don't contain streams, but copy them faithfully.
    const clone = value.clone(dstCtx);
    for (const [key, entry] of value.dict.entries()) {
      clone.dict.set(key, cloneWithPageMap(entry, srcCtx, dstCtx, pageMap, visited));
    }
    return clone;
  }
  return value.clone();
}

/** Copy one indirect object (allocated a fresh ref) into `dstCtx`. */
function cloneIndirect(
  ref: PDFRef,
  srcCtx: PDFContext,
  dstCtx: PDFContext,
  pageMap: Map<number, PDFRef>,
  visited: Map<number, PDFRef>,
): PDFRef {
  const cached = visited.get(ref.objectNumber);
  if (cached) return cached;
  const newRef = dstCtx.nextRef();
  visited.set(ref.objectNumber, newRef);
  const srcObj = srcCtx.lookup(ref);
  if (srcObj) {
    dstCtx.assign(newRef, cloneWithPageMap(srcObj, srcCtx, dstCtx, pageMap, visited));
  }
  return newRef;
}
