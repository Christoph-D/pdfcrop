import { describe, expect, it } from "vitest";
import { clusterPages, choosePagesToMerge, roundSize, type Cluster } from "./cluster";
import type { PageMetadata } from "./types";

function page(n: number, w = 595, h = 842): PageMetadata {
  return { pageNumber: n, width: w, height: h, rotation: 0 };
}

describe("roundSize", () => {
  it("quantizes to nearest 20 units (floor)", () => {
    expect(roundSize(0)).toBe(0);
    expect(roundSize(19)).toBe(0);
    expect(roundSize(20)).toBe(20);
    expect(roundSize(21)).toBe(20);
    expect(roundSize(39)).toBe(20);
    expect(roundSize(40)).toBe(40);
  });
});

describe("clusterPages", () => {
  it("splits even and odd pages into separate clusters", () => {
    const clusters = clusterPages([page(1), page(2), page(3), page(4)]);
    expect(clusters).toHaveLength(2);
    const odd = clusters.find((c) => c.parity === "odd")!;
    const even = clusters.find((c) => c.parity === "even")!;
    expect(odd.allPages).toEqual([1, 3]);
    expect(even.allPages).toEqual([2, 4]);
  });

  it("merges pages in the same 20-unit size bucket", () => {
    // Java rounds via (int)(x/20)*20, so values within the same bucket merge
    // but values straddling a bucket boundary do not, even if within 20 units.
    const clusters = clusterPages([
      page(1, 595, 842), // bucket 580x840
      page(3, 597, 845), // bucket 580x840
      page(5, 599, 855), // bucket 580x840
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.allPages).toEqual([1, 3, 5]);
  });

  it("does not merge pages straddling a 20-unit bucket boundary", () => {
    // 599 -> 580, 600 -> 600 (differ by 1 unit, but separate buckets)
    const clusters = clusterPages([page(1, 599, 842), page(3, 600, 842)]);
    expect(clusters).toHaveLength(2);
  });

  it("places pages with multiple sizes in distinct clusters per parity", () => {
    const clusters = clusterPages([
      page(1, 595, 842),
      page(2, 595, 842),
      page(3, 595, 842),
      page(4, 595, 842),
      page(5, 842, 595), // landscape, same parity as page 1
      page(6, 842, 595),
    ]);
    expect(clusters).toHaveLength(4);
  });
});

describe("choosePagesToMerge (via clusterPages)", () => {
  function makeCluster(n: number): Cluster {
    const allPages = Array.from({ length: n }, (_, i) => i + 1);
    return {
      id: "x",
      parity: "odd",
      width: 595,
      height: 842,
      roundedWidth: 580,
      roundedHeight: 840,
      allPages,
      pagesToMerge: choosePagesToMerge(allPages),
    };
  }

  it("returns all pages when fewer than 15", () => {
    expect(makeCluster(10).pagesToMerge).toHaveLength(10);
  });

  it("subsamples to 15 when more than 15 pages", () => {
    expect(makeCluster(100).pagesToMerge).toHaveLength(15);
    expect(makeCluster(150).pagesToMerge).toHaveLength(15);
    // First sampled page is always page 1
    expect(makeCluster(100).pagesToMerge[0]).toBe(1);
  });
});
