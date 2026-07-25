import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDocument,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFPage,
  PDFRef,
  PDFString,
} from "pdf-lib";
import { cropPdf, type CropInput } from "./write";
import { clusterPages } from "./cluster";
import type { PageMetadata } from "./types";
import type { CropRect } from "@/store/cropStore";

const W = 595;
const H = 842;

function pageMeta(n: number): PageMetadata {
  return { pageNumber: n, width: W, height: H, rotation: 0 };
}

/**
 * Build a small source PDF whose catalog has an explicit /Outlines tree with
 * one top-level bookmark per entry, each targeting a page via an explicit
 * `[pageRef /Fit]` destination array (the most common form in real PDFs).
 */
async function buildSourceWithOutlines(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const pages: PDFPage[] = [];
  for (let i = 0; i < 3; i++) pages.push(doc.addPage([W, H]));

  const ctx = doc.context;
  const entries = [
    { title: "Page 1", pageRef: pages[0]!.ref },
    { title: "Page 2", pageRef: pages[1]!.ref },
    { title: "Page 3", pageRef: pages[2]!.ref },
  ];

  const items = entries.map(({ title, pageRef }) => {
    const item = PDFDict.withContext(ctx);
    item.set(PDFName.of("Title"), PDFString.of(title));
    item.set(PDFName.of("Dest"), ctx.obj([pageRef, "Fit"]));
    return { dict: item, ref: ctx.register(item) };
  });

  const root = PDFDict.withContext(ctx);
  root.set(PDFName.of("Type"), PDFName.of("Outlines"));
  root.set(PDFName.of("Count"), PDFNumber.of(items.length));
  const rootRef = ctx.register(root);
  items.forEach((it, i) => {
    it.dict.set(PDFName.of("Parent"), rootRef);
    if (i > 0) it.dict.set(PDFName.of("Prev"), items[i - 1]!.ref);
    if (i < items.length - 1) it.dict.set(PDFName.of("Next"), items[i + 1]!.ref);
  });
  root.set(PDFName.of("First"), items[0]!.ref);
  root.set(PDFName.of("Last"), items[items.length - 1]!.ref);
  doc.catalog.set(PDFName.of("Outlines"), rootRef);

  return doc.save();
}

/**
 * Build a small source PDF whose bookmarks reference pages *by name*, and
 * whose catalog carries a `/Names /Dests` name tree resolving those names to
 * explicit `[pageRef /Fit]` destinations. This mirrors PDFs exported from
 * Word, LaTeX, and similar tools, where clicking an outline item requires
 * resolving the name through the catalog's Names tree.
 */
async function buildSourceWithNamedDestinations(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const pages: PDFPage[] = [];
  for (let i = 0; i < 3; i++) pages.push(doc.addPage([W, H]));
  const ctx = doc.context;

  const entries = [
    { title: "Page 1", name: "page1", pageRef: pages[0]!.ref },
    { title: "Page 2", name: "page2", pageRef: pages[1]!.ref },
    { title: "Page 3", name: "page3", pageRef: pages[2]!.ref },
  ];

  // Named-destination name tree: a flat leaf node with a /Names array of
  // alternating [text-string name, destination array] pairs.
  const destsNames = PDFArray.withContext(ctx);
  for (const { name, pageRef } of entries) {
    destsNames.push(PDFHexString.fromText(name));
    destsNames.push(ctx.obj([pageRef, "Fit"]));
  }
  const dests = PDFDict.withContext(ctx);
  dests.set(PDFName.of("Names"), destsNames);
  const limits = PDFArray.withContext(ctx);
  limits.push(PDFHexString.fromText("page1"));
  limits.push(PDFHexString.fromText("page3"));
  dests.set(PDFName.of("Limits"), limits);
  const names = PDFDict.withContext(ctx);
  names.set(PDFName.of("Dests"), dests);
  doc.catalog.set(PDFName.of("Names"), names);

  // Outline items reference destinations by NAME (PDFName), as Word/LaTeX do.
  const items = entries.map(({ title, name }) => {
    const item = PDFDict.withContext(ctx);
    item.set(PDFName.of("Title"), PDFString.of(title));
    item.set(PDFName.of("Dest"), PDFName.of(name));
    return { dict: item, ref: ctx.register(item) };
  });
  const root = PDFDict.withContext(ctx);
  root.set(PDFName.of("Type"), PDFName.of("Outlines"));
  root.set(PDFName.of("Count"), PDFNumber.of(items.length));
  const rootRef = ctx.register(root);
  items.forEach((it, i) => {
    it.dict.set(PDFName.of("Parent"), rootRef);
    if (i > 0) it.dict.set(PDFName.of("Prev"), items[i - 1]!.ref);
    if (i < items.length - 1) it.dict.set(PDFName.of("Next"), items[i + 1]!.ref);
  });
  root.set(PDFName.of("First"), items[0]!.ref);
  root.set(PDFName.of("Last"), items[items.length - 1]!.ref);
  doc.catalog.set(PDFName.of("Outlines"), rootRef);

  return doc.save();
}

interface ReadBookmark {
  title: string;
  /** Object number of the destination page reference, or null if none. */
  destPageObjNum: number | null;
}

/** Return `value` as a raw PDFRef (does not dereference). */
function asRef(value: PDFObject | undefined): PDFRef | undefined {
  return value instanceof PDFRef ? value : undefined;
}

/** Resolve a destination (`[pageRef ...]` array, direct or indirect) to a page ref. */
function destPageRef(doc: PDFDocument, value: PDFObject | undefined): PDFRef | undefined {
  const arr =
    value instanceof PDFArray ? value : value instanceof PDFRef ? doc.context.lookup(value, PDFArray) : undefined;
  const first = arr?.get(0);
  return first instanceof PDFRef ? first : undefined;
}

/** Walk a document's outline tree and return its top-level bookmarks. */
function readOutlines(doc: PDFDocument): ReadBookmark[] {
  const root = doc.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  if (!root) return [];
  const out: ReadBookmark[] = [];
  let cur = asRef(root.get(PDFName.of("First")));
  while (cur) {
    const item = doc.context.lookup(cur, PDFDict);
    const titleVal = item.get(PDFName.of("Title"));
    const title = titleVal instanceof PDFString || titleVal instanceof PDFHexString ? titleVal.decodeText() : "";
    // Resolve a /Dest page reference, or a /A /D page reference.
    let pageRef = destPageRef(doc, item.get(PDFName.of("Dest")));
    if (!pageRef) {
      const action = doc.context.lookupMaybe(item.get(PDFName.of("A")), PDFDict);
      pageRef = destPageRef(doc, action?.get(PDFName.of("D")));
    }
    out.push({ title, destPageObjNum: pageRef ? pageRef.objectNumber : null });
    cur = asRef(item.get(PDFName.of("Next")));
  }
  return out;
}

/**
 * Return the 1-based index of the first page-tree entry whose object number
 * matches `objNum` (bookmarks point at the first copy of a multiplied page).
 */
function firstOutputIndexOf(doc: PDFDocument, objNum: number): number {
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    if (pages[i]!.ref.objectNumber === objNum) return i + 1;
  }
  throw new Error(`no output page with object number ${objNum}`);
}

/** Walk a document's outline tree and return its name-based bookmarks. */
function readNamedOutlines(doc: PDFDocument): { title: string; destName: string | null }[] {
  const root = doc.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  if (!root) return [];
  const out: { title: string; destName: string | null }[] = [];
  let cur = asRef(root.get(PDFName.of("First")));
  while (cur) {
    const item = doc.context.lookup(cur, PDFDict);
    const titleVal = item.get(PDFName.of("Title"));
    const title = titleVal instanceof PDFString || titleVal instanceof PDFHexString ? titleVal.decodeText() : "";
    const dest = item.get(PDFName.of("Dest"));
    const destName =
      dest instanceof PDFName || dest instanceof PDFString || dest instanceof PDFHexString ? dest.decodeText() : null;
    out.push({ title, destName });
    cur = asRef(item.get(PDFName.of("Next")));
  }
  return out;
}

/**
 * Resolve a named destination `name` through the catalog's `/Names /Dests`
 * name tree, returning the page ref of its `[pageRef …]` destination array.
 * Recurses into `/Kids` and scans leaf `/Names` (alternating key/value) pairs,
 * mirroring how a PDF reader resolves a named-destination bookmark.
 */
function resolveNamedDest(doc: PDFDocument, name: string): PDFRef | undefined {
  const names = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const destsRoot = names?.lookupMaybe(PDFName.of("Dests"), PDFDict);
  if (!destsRoot) return undefined;
  return searchNameTreeForPage(doc, destsRoot, name);
}

function searchNameTreeForPage(doc: PDFDocument, node: PDFDict, name: string): PDFRef | undefined {
  const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
  if (kids) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = doc.context.lookup(kids.get(i), PDFDict);
      const found = searchNameTreeForPage(doc, kid, name);
      if (found) return found;
    }
    return undefined;
  }
  const entries = node.lookupMaybe(PDFName.of("Names"), PDFArray);
  if (!entries) return undefined;
  for (let i = 0; i + 1 < entries.size(); i += 2) {
    const key = entries.get(i);
    const keyText = key instanceof PDFString || key instanceof PDFHexString ? key.decodeText() : "";
    if (keyText === name) return destPageRef(doc, entries.get(i + 1));
  }
  return undefined;
}

function rect(x: number, y: number, w: number, h: number, id: string): CropRect {
  return { x, y, w, h, id };
}

async function runCrop(
  sourceData: Uint8Array,
  rectsByCluster: Record<string, CropRect[]>,
): Promise<{ bytes: Uint8Array; outputPageCount: number; outlinePreserved: boolean }> {
  const metas = [pageMeta(1), pageMeta(2), pageMeta(3)];
  const clusters = clusterPages(metas);
  const input: CropInput = {
    source: {
      data: sourceData.slice().buffer as ArrayBuffer,
      fileName: "in.pdf",
      pages: metas,
    },
    clusters,
    rectsByCluster,
    previews: clusters.map((c) => ({ clusterId: c.id, preview: { width: W, height: H } })),
  };
  return cropPdf(input);
}

describe("cropPdf outline preservation", () => {
  it("shifts bookmark targets to the first copy when a cluster is multiplied", async () => {
    const source = await buildSourceWithOutlines();
    const clusters = clusterPages([pageMeta(1), pageMeta(2), pageMeta(3)]);
    const odd = clusters.find((c) => c.parity === "odd")!; // pages 1 & 3
    const even = clusters.find((c) => c.parity === "even")!; // page 2

    // Two rects on the odd cluster -> pages 1 and 3 are each multiplied by 2.
    // One rect on the even cluster -> page 2 stays single.
    // Output page order (1-based): p1a=1, p1b=2, p2=3, p3a=4, p3b=5.
    const out = await runCrop(source, {
      [odd.id]: [rect(0, 0, W / 2, H, "a"), rect(W / 2, 0, W / 2, H, "b")],
      [even.id]: [rect(0, 0, W, H, "a")],
    });

    expect(out.outputPageCount).toBe(5);
    expect(out.outlinePreserved).toBe(true);

    const doc = await PDFDocument.load(out.bytes);
    const bookmarks = readOutlines(doc);
    expect(bookmarks.map((b) => b.title)).toEqual(["Page 1", "Page 2", "Page 3"]);

    // Each bookmark now resolves to the FIRST copy of its original page.
    const p1 = firstOutputIndexOf(doc, doc.getPages()[0]!.ref.objectNumber);
    const p2 = firstOutputIndexOf(doc, doc.getPages()[2]!.ref.objectNumber);
    const p3 = firstOutputIndexOf(doc, doc.getPages()[3]!.ref.objectNumber);
    expect(p1).toBe(1);
    expect(p2).toBe(3);
    expect(p3).toBe(4);

    expect(firstOutputIndexOf(doc, bookmarks[0]!.destPageObjNum!)).toBe(p1);
    expect(firstOutputIndexOf(doc, bookmarks[1]!.destPageObjNum!)).toBe(p2);
    expect(firstOutputIndexOf(doc, bookmarks[2]!.destPageObjNum!)).toBe(p3);
  });

  it("keeps outlines (and outlinePreserved) when there is no multiplication", async () => {
    const source = await buildSourceWithOutlines();
    const clusters = clusterPages([pageMeta(1), pageMeta(2), pageMeta(3)]);
    const odd = clusters.find((c) => c.parity === "odd")!;
    const even = clusters.find((c) => c.parity === "even")!;

    const out = await runCrop(source, {
      [odd.id]: [rect(0, 0, W, H, "a")],
      [even.id]: [rect(0, 0, W, H, "a")],
    });

    expect(out.outlinePreserved).toBe(true);
    const doc = await PDFDocument.load(out.bytes);
    expect(readOutlines(doc).map((b) => b.title)).toEqual(["Page 1", "Page 2", "Page 3"]);
  });

  it("reports outlinePreserved=true and no warning when the source has no outlines", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([W, H]);
    doc.addPage([W, H]);
    doc.addPage([W, H]);
    const source = await doc.save();

    const clusters = clusterPages([pageMeta(1), pageMeta(2), pageMeta(3)]);
    const odd = clusters.find((c) => c.parity === "odd")!;
    const even = clusters.find((c) => c.parity === "even")!;

    const out = await runCrop(source, {
      [odd.id]: [rect(0, 0, W / 2, H, "a"), rect(W / 2, 0, W / 2, H, "b")],
      [even.id]: [rect(0, 0, W, H, "a")],
    });

    expect(out.outlinePreserved).toBe(true);
  });

  it("carries named destinations so name-based bookmarks jump to the first copy", async () => {
    const source = await buildSourceWithNamedDestinations();
    const clusters = clusterPages([pageMeta(1), pageMeta(2), pageMeta(3)]);
    const odd = clusters.find((c) => c.parity === "odd")!; // pages 1 & 3
    const even = clusters.find((c) => c.parity === "even")!; // page 2

    // Two rects on the odd cluster -> pages 1 and 3 are each multiplied by 2.
    // Output page order (1-based): p1a=1, p1b=2, p2=3, p3a=4, p3b=5.
    const out = await runCrop(source, {
      [odd.id]: [rect(0, 0, W / 2, H, "a"), rect(W / 2, 0, W / 2, H, "b")],
      [even.id]: [rect(0, 0, W, H, "a")],
    });

    expect(out.outputPageCount).toBe(5);
    expect(out.outlinePreserved).toBe(true);

    const doc = await PDFDocument.load(out.bytes);
    const bookmarks = readNamedOutlines(doc);
    expect(bookmarks.map((b) => b.title)).toEqual(["Page 1", "Page 2", "Page 3"]);
    // Outline items still reference destinations by name (not flattened).
    expect(bookmarks.map((b) => b.destName)).toEqual(["page1", "page2", "page3"]);

    // Each name now resolves through the output's `/Names /Dests` to the FIRST
    // output copy of its original page (without the carried name tree the
    // names would dangle and these would be undefined).
    expect(firstOutputIndexOf(doc, resolveNamedDest(doc, "page1")!.objectNumber)).toBe(1);
    expect(firstOutputIndexOf(doc, resolveNamedDest(doc, "page2")!.objectNumber)).toBe(3);
    expect(firstOutputIndexOf(doc, resolveNamedDest(doc, "page3")!.objectNumber)).toBe(4);
  });
});
