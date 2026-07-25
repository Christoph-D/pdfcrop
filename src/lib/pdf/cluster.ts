import type { PageMetadata } from "./types";

export const MERGE_VARIABILITY = 20;
export const MAX_MERGE_PAGES = 15;

export type Parity = "even" | "odd";

export function roundSize(value: number): number {
  return Math.floor(value / MERGE_VARIABILITY) * MERGE_VARIABILITY;
}

export interface Cluster {
  id: string;
  parity: Parity;
  width: number;
  height: number;
  roundedWidth: number;
  roundedHeight: number;
  allPages: number[];
  pagesToMerge: number[];
  /**
   * True when this cluster exists only because its page(s) were excluded —
   * each excluded page becomes its own singleton cluster. Mirrors Briss's
   * `PageCluster.excluded` flag, which also prevents excluded pages from
   * merging with anything.
   */
  excluded?: boolean;
}

export function choosePagesToMerge(allPages: number[]): number[] {
  if (allPages.length <= MAX_MERGE_PAGES) return [...allPages];
  const sorted = [...allPages].sort((a, b) => a - b);
  const step = Math.floor(sorted.length / MAX_MERGE_PAGES);
  const sampled: number[] = [];
  for (let i = 0; i < sorted.length && sampled.length < MAX_MERGE_PAGES; i += step) {
    sampled.push(sorted[i]!);
  }
  return sampled;
}

function clusterKey(parity: Parity, width: number, height: number): string {
  return `${parity}|${roundSize(width)}|${roundSize(height)}`;
}

export function clusterPages(pages: PageMetadata[], excludes?: ReadonlySet<number>): Cluster[] {
  const byKey = new Map<string, Cluster>();

  for (const page of pages) {
    const parity: Parity = page.pageNumber % 2 === 0 ? "even" : "odd";
    const excluded = excludes?.has(page.pageNumber) ?? false;
    // Excluded pages never merge with anything — they each get a unique
    // cluster keyed by their page number (a singleton). Mirrors Briss's
    // `PageCluster.isClusterNearlyEqual`, which returns false when either
    // cluster is excluded.
    const key = excluded ? `excluded|${page.pageNumber}` : clusterKey(parity, page.width, page.height);
    let cluster = byKey.get(key);
    if (!cluster) {
      cluster = {
        id: key,
        parity,
        width: page.width,
        height: page.height,
        roundedWidth: roundSize(page.width),
        roundedHeight: roundSize(page.height),
        allPages: [],
        pagesToMerge: [],
        excluded,
      };
      byKey.set(key, cluster);
    }
    cluster.allPages.push(page.pageNumber);
  }

  for (const cluster of byKey.values()) {
    cluster.pagesToMerge = choosePagesToMerge(cluster.allPages);
  }

  return [...byKey.values()].sort((a, b) => {
    if (a.parity !== b.parity) return a.parity === "odd" ? -1 : 1;
    return firstPage(a) - firstPage(b);
  });
}

function firstPage(cluster: Cluster): number {
  let min = Infinity;
  for (const p of cluster.allPages) if (p < min) min = p;
  return min;
}

/**
 * A plain pixel rect (top-left origin) — the shape stored per cluster, without
 * an identity/id. Shared by crop-rect transfer so `cluster.ts` need not depend
 * on the crop store.
 */
export interface RectShape {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Port of `BrissSwingGUI.copyCropsToClusters`. After re-clustering, carries
 * the user's already-drawn crop rectangles over to the new clusters by
 * matching on `(parity, roundedWidth, roundedHeight)`.
 *
 * Matching by size (rather than page number) is valid because preview
 * dimensions are identical within a size group — pages render to a fixed
 * `MAX_PAGE_HEIGHT` and the same page width, so pixel rects map 1:1. Results
 * are de-duplicated by shape, mirroring Briss's `cropRatiosList.contains`.
 */
export function transferRectsBySize(
  oldClusters: Cluster[],
  newClusters: Cluster[],
  rectsByOldCluster: Record<string, readonly RectShape[]>,
): Record<string, RectShape[]> {
  const result: Record<string, RectShape[]> = {};
  for (const next of newClusters) {
    const collected: RectShape[] = [];
    const seen = new Set<string>();
    for (const prev of oldClusters) {
      if (
        prev.parity === next.parity &&
        prev.roundedWidth === next.roundedWidth &&
        prev.roundedHeight === next.roundedHeight
      ) {
        for (const r of rectsByOldCluster[prev.id] ?? []) {
          const key = `${r.x}|${r.y}|${r.w}|${r.h}`;
          if (!seen.has(key)) {
            seen.add(key);
            collected.push({ x: r.x, y: r.y, w: r.w, h: r.h });
          }
        }
      }
    }
    if (collected.length) result[next.id] = collected;
  }
  return result;
}

/**
 * Parse a page-exclude list in Briss syntax (`1-4;6;9`), where ranges are
 * inclusive. Port of `PageNumberParser.parsePageNumber`. Throws on invalid
 * characters, malformed ranges, or ranges where start > end.
 */
export function parsePageExcludes(input: string): Set<number> {
  const result = new Set<number>();
  const trimmed = input.trim();
  if (!trimmed) return result;
  if (!/^[0-9\-;]+$/.test(trimmed)) {
    throw new Error('Allowed characters: digits "0-9", ";", "-"');
  }
  for (const token of trimmed.split(";")) {
    const part = token.trim();
    if (!part) continue;
    const dashCount = (part.match(/-/g) ?? []).length;
    if (dashCount === 0) {
      const n = Number.parseInt(part, 10);
      if (Number.isNaN(n)) throw new Error(`Invalid page number "${part}"`);
      result.add(n);
    } else if (dashCount === 1) {
      const [startStr, endStr] = part.split("-");
      const start = Number.parseInt(startStr ?? "", 10);
      const end = Number.parseInt(endStr ?? "", 10);
      if (Number.isNaN(start) || Number.isNaN(end)) throw new Error(`Invalid range "${part}"`);
      if (start > end) throw new Error(`End must be bigger than start in "${part}"`);
      for (let i = start; i <= end; i++) result.add(i);
    } else {
      throw new Error(`"${part}" has too many "-" characters`);
    }
  }
  return result;
}
