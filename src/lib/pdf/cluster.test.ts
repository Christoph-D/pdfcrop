import { describe, expect, it } from "vitest";
import {
  clusterPages,
  choosePagesToMerge,
  roundSize,
  parsePageExcludes,
  transferRectsBySize,
  type Cluster,
} from "./cluster";
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

describe("clusterPages with excludes", () => {
  it("forces each excluded page into its own singleton cluster", () => {
    const excludes = new Set([2, 5]);
    const clusters = clusterPages([page(1), page(2), page(3), page(4), page(5)], excludes);
    // Without excludes: 2 clusters (odd, even). With 2 excluded pages: 4.
    expect(clusters).toHaveLength(4);

    const singletons = clusters.filter((c) => c.excluded);
    expect(singletons).toHaveLength(2);
    expect(singletons.map((c) => c.allPages).sort((a, b) => a[0]! - b[0]!)).toEqual([[2], [5]]);
    // Each excluded cluster has a unique id.
    expect(singletons[0]!.id).not.toBe(singletons[1]!.id);

    // Remaining pages still merge by parity.
    const odd = clusters.find((c) => !c.excluded && c.parity === "odd")!;
    const even = clusters.find((c) => !c.excluded && c.parity === "even")!;
    expect(odd.allPages).toEqual([1, 3]);
    // page 2 was pulled out into its own singleton, leaving only page 4.
    expect(even.allPages).toEqual([4]);
  });

  it("does not merge two excluded pages even if same size", () => {
    const clusters = clusterPages([page(2), page(4)], new Set([2, 4]));
    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.excluded && c.allPages.length === 1)).toBe(true);
  });

  it("no excludes behaves identically to the original signature", () => {
    const a = clusterPages([page(1), page(2)]);
    const b = clusterPages([page(1), page(2)], new Set());
    expect(b.map((c) => c.id)).toEqual(a.map((c) => c.id));
    expect(b.every((c) => !c.excluded)).toBe(true);
  });
});

describe("parsePageExcludes", () => {
  it("parses singles and ranges separated by ;", () => {
    expect([...parsePageExcludes("1-4;6;9")].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 6, 9]);
  });

  it("ignores empty tokens (trailing/leading/double semicolons)", () => {
    expect([...parsePageExcludes(";3;;5;")].sort((a, b) => a - b)).toEqual([3, 5]);
  });

  it("returns an empty set for blank input", () => {
    expect(parsePageExcludes("").size).toBe(0);
    expect(parsePageExcludes("   ").size).toBe(0);
  });

  it("deduplicates overlapping ranges and singles", () => {
    expect([...parsePageExcludes("1-5;3;4-5")].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("throws on disallowed characters", () => {
    expect(() => parsePageExcludes("1,2")).toThrow();
    expect(() => parsePageExcludes("a")).toThrow();
  });

  it("throws when a range start exceeds its end", () => {
    expect(() => parsePageExcludes("5-2")).toThrow();
  });

  it("throws on too many dashes in a token", () => {
    expect(() => parsePageExcludes("1-2-3")).toThrow();
  });
});

describe("transferRectsBySize", () => {
  function cluster(id: string, parity: "odd" | "even", w: number, pages: number[], excluded = false): Cluster {
    return {
      id,
      parity,
      width: w,
      height: 842,
      roundedWidth: roundSize(w),
      roundedHeight: roundSize(842),
      allPages: pages,
      pagesToMerge: pages,
      excluded,
    };
  }

  it("copies rects from old clusters to new clusters with matching parity + rounded size", () => {
    const oldClusters = [cluster("odd|x", "odd", 595, [1, 3, 5, 7])];
    const newClusters = [cluster("odd|x", "odd", 595, [1, 3, 7]), cluster("excluded|5", "odd", 595, [5], true)];
    const oldRects = { "odd|x": [{ x: 1, y: 2, w: 3, h: 4 }] };
    const out = transferRectsBySize(oldClusters, newClusters, oldRects);
    // Both new clusters share parity + size with the old one, so both inherit.
    expect(out["odd|x"]).toHaveLength(1);
    expect(out["excluded|5"]).toHaveLength(1);
  });

  it("dedupes rects with identical shape coming from multiple matching old clusters", () => {
    const oldClusters = [cluster("odd|x", "odd", 595, [1, 3, 7]), cluster("excluded|5", "odd", 595, [5], true)];
    const newClusters = [cluster("odd|y", "odd", 595, [1, 3, 5, 7])];
    const oldRects = {
      "odd|x": [{ x: 1, y: 2, w: 3, h: 4 }],
      "excluded|5": [
        { x: 1, y: 2, w: 3, h: 4 },
        { x: 9, y: 9, w: 1, h: 1 },
      ],
    };
    const out = transferRectsBySize(oldClusters, newClusters, oldRects);
    expect(out["odd|y"]).toHaveLength(2);
  });

  it("does not transfer rects across different parity or size", () => {
    const oldClusters = [cluster("odd|x", "odd", 595, [1, 3]), cluster("even|y", "even", 595, [2, 4])];
    const newClusters = [cluster("odd|z", "odd", 595, [1, 3])];
    const oldRects = {
      "odd|x": [{ x: 1, y: 2, w: 3, h: 4 }],
      "even|y": [{ x: 5, y: 6, w: 7, h: 8 }],
    };
    const out = transferRectsBySize(oldClusters, newClusters, oldRects);
    expect(out["odd|z"]!).toEqual([{ x: 1, y: 2, w: 3, h: 4 }]);
  });

  it("omits new clusters with no matching rects", () => {
    const oldClusters: Cluster[] = [];
    const newClusters = [cluster("odd|x", "odd", 595, [1, 3])];
    expect(transferRectsBySize(oldClusters, newClusters, {})).toEqual({});
  });
});
