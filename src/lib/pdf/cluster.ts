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

export function clusterPages(pages: PageMetadata[]): Cluster[] {
  const byKey = new Map<string, Cluster>();

  for (const page of pages) {
    const parity: Parity = page.pageNumber % 2 === 0 ? "even" : "odd";
    const key = clusterKey(parity, page.width, page.height);
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
    return a.id.localeCompare(b.id);
  });
}
