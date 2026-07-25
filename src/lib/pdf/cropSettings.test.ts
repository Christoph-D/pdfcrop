import { describe, expect, it } from "vitest";
import {
  cropSettingsFileName,
  exportCropSettings,
  importCropSettings,
  parseCropSettings,
  serializeCropSettings,
  type CropSettings,
} from "./cropSettings";
import type { Cluster } from "./cluster";
import { roundSize } from "./cluster";
import type { CropRect } from "@/store/cropStore";

function makeCluster(opts: { parity?: "odd" | "even"; width?: number; height?: number; pages?: number[] }): Cluster {
  const parity = opts.parity ?? "odd";
  const width = opts.width ?? 595;
  const height = opts.height ?? 842;
  const allPages = opts.pages ?? [1, 3, 5];
  return {
    id: `${parity}|${roundSize(width)}|${roundSize(height)}`,
    parity,
    width,
    height,
    roundedWidth: roundSize(width),
    roundedHeight: roundSize(height),
    allPages,
    pagesToMerge: allPages,
  };
}

function rect(id: string, x: number, y: number, w: number, h: number): CropRect {
  return { id, x, y, w, h };
}

function idFactory(): () => string {
  let n = 0;
  return () => `r${n++}`;
}

describe("exportCropSettings", () => {
  it("captures per-cluster ratios and excludes", () => {
    const cluster = makeCluster({ parity: "odd", width: 595, height: 842 });
    const settings = exportCropSettings({
      clusters: [cluster],
      rectsByCluster: {
        [cluster.id]: [rect("a", 10, 20, 80, 160)],
      },
      previews: [{ clusterId: cluster.id, preview: { width: 100, height: 200 } }],
      excludes: [3, 7],
    });
    expect(settings.excludes).toEqual([3, 7]);
    expect(settings.clusters).toHaveLength(1);
    const entry = settings.clusters[0]!;
    expect(entry.even).toBe(false);
    expect(entry.w).toBe(595);
    expect(entry.h).toBe(842);
    // pixelRectToRatios((10,20,80,160) on 100x200) -> [0.1, 0.1, 0.1, 0.1]
    const r = entry.ratios[0]!;
    expect(r[0]).toBeCloseTo(0.1);
    expect(r[1]).toBeCloseTo(0.1);
    expect(r[2]).toBeCloseTo(0.1);
    expect(r[3]).toBeCloseTo(0.1);
  });

  it("defaults excludes to an empty array", () => {
    const cluster = makeCluster({});
    const settings = exportCropSettings({
      clusters: [cluster],
      rectsByCluster: {},
      previews: [{ clusterId: cluster.id, preview: { width: 100, height: 200 } }],
    });
    expect(settings.excludes).toEqual([]);
    expect(settings.clusters[0]!.ratios).toEqual([]);
  });

  it("emits zero ratios when a cluster has no preview dims", () => {
    const cluster = makeCluster({});
    const settings = exportCropSettings({
      clusters: [cluster],
      rectsByCluster: { [cluster.id]: [rect("a", 1, 2, 3, 4)] },
      previews: [],
    });
    expect(settings.clusters[0]!.ratios).toEqual([[0, 0, 0, 0]]);
  });
});

describe("importCropSettings", () => {
  it("matches a saved cluster by (parity, roundedW, roundedH) and rebuilds rects", () => {
    const live = makeCluster({ parity: "odd", width: 595, height: 842 });
    const settings: CropSettings = {
      excludes: [],
      clusters: [{ even: false, w: 595, h: 842, ratios: [[0.1, 0.1, 0.1, 0.1]] }],
    };
    const result = importCropSettings(
      settings,
      [live],
      [{ clusterId: live.id, preview: { width: 100, height: 200 } }],
      idFactory(),
    );
    expect(result.matched).toBe(1);
    expect(result.skipped).toBe(0);
    const rects = result.rectsByCluster[live.id]!;
    expect(rects).toHaveLength(1);
    // ratiosToPixelRect([.1,.1,.1,.1], 100, 200) -> (10, 20, 80, 160)
    expect(rects[0]!.x).toBeCloseTo(10);
    expect(rects[0]!.y).toBeCloseTo(20);
    expect(rects[0]!.w).toBeCloseTo(80);
    expect(rects[0]!.h).toBeCloseTo(160);
    expect(rects[0]!.id).toBe("r0");
  });

  it("matches across small size differences via rounding", () => {
    // Saved width 595 (bucket 580) vs live width 597 (also bucket 580).
    const live = makeCluster({ parity: "even", width: 597, height: 845 });
    const settings: CropSettings = {
      excludes: [],
      clusters: [{ even: true, w: 595, h: 842, ratios: [[0, 0, 0, 0]] }],
    };
    const result = importCropSettings(
      settings,
      [live],
      [{ clusterId: live.id, preview: { width: 100, height: 200 } }],
      idFactory(),
    );
    expect(result.matched).toBe(1);
  });

  it("skips entries that do not match any live cluster", () => {
    const live = makeCluster({ parity: "odd", width: 595, height: 842 });
    const settings: CropSettings = {
      excludes: [],
      clusters: [
        { even: true, w: 595, h: 842, ratios: [[0.1, 0.1, 0.1, 0.1]] }, // wrong parity
        { even: false, w: 1000, h: 1000, ratios: [[0.1, 0.1, 0.1, 0.1]] }, // wrong size
      ],
    };
    const result = importCropSettings(
      settings,
      [live],
      [{ clusterId: live.id, preview: { width: 100, height: 200 } }],
      idFactory(),
    );
    expect(result.matched).toBe(0);
    expect(result.skipped).toBe(2);
    expect(result.rectsByCluster[live.id]).toBeUndefined();
  });

  it("scales ratios to the live preview resolution", () => {
    // Same ratios, but the live preview renders at half the export resolution.
    const live = makeCluster({ parity: "odd", width: 595, height: 842 });
    const settings: CropSettings = {
      excludes: [],
      clusters: [{ even: false, w: 595, h: 842, ratios: [[0.1, 0.1, 0.1, 0.1]] }],
    };
    const result = importCropSettings(
      settings,
      [live],
      [{ clusterId: live.id, preview: { width: 50, height: 100 } }],
      idFactory(),
    );
    const rects = result.rectsByCluster[live.id]!;
    expect(rects[0]!.x).toBeCloseTo(5);
    expect(rects[0]!.y).toBeCloseTo(10);
    expect(rects[0]!.w).toBeCloseTo(40);
    expect(rects[0]!.h).toBeCloseTo(80);
  });

  it("clamps out-of-range ratios into [0,1]", () => {
    const live = makeCluster({ parity: "odd", width: 595, height: 842 });
    const settings: CropSettings = {
      excludes: [],
      clusters: [{ even: false, w: 595, h: 842, ratios: [[-1, 2, 0.5, 0.5]] }],
    };
    const result = importCropSettings(
      settings,
      [live],
      [{ clusterId: live.id, preview: { width: 100, height: 200 } }],
      idFactory(),
    );
    expect(result.matched).toBe(1);
    // No throw is the main assertion; rebuilt rects should be finite.
    const r = result.rectsByCluster[live.id]![0]!;
    expect(Number.isFinite(r.w)).toBe(true);
    expect(Number.isFinite(r.h)).toBe(true);
  });
});

describe("serialize / parse round-trip", () => {
  it("export -> serialize -> parse -> import reproduces the original rects", () => {
    const live = makeCluster({ parity: "odd", width: 595, height: 842 });
    const original = [rect("a", 10, 20, 80, 160), rect("b", 5, 5, 90, 190)];
    const exported = exportCropSettings({
      clusters: [live],
      rectsByCluster: { [live.id]: original },
      previews: [{ clusterId: live.id, preview: { width: 100, height: 200 } }],
      excludes: [2, 4],
    });
    const json = serializeCropSettings(exported);
    const parsed = parseCropSettings(json);
    expect(parsed.excludes).toEqual([2, 4]);

    const result = importCropSettings(
      parsed,
      [live],
      [{ clusterId: live.id, preview: { width: 100, height: 200 } }],
      idFactory(),
    );
    expect(result.matched).toBe(1);
    const rebuilt = result.rectsByCluster[live.id]!;
    expect(rebuilt).toHaveLength(2);
    for (let i = 0; i < original.length; i++) {
      expect(rebuilt[i]!.x).toBeCloseTo(original[i]!.x);
      expect(rebuilt[i]!.y).toBeCloseTo(original[i]!.y);
      expect(rebuilt[i]!.w).toBeCloseTo(original[i]!.w);
      expect(rebuilt[i]!.h).toBeCloseTo(original[i]!.h);
    }
  });

  it("serialized output matches the documented schema shape", () => {
    const cluster = makeCluster({ parity: "even", width: 595, height: 842 });
    const settings = exportCropSettings({
      clusters: [cluster],
      rectsByCluster: { [cluster.id]: [rect("a", 5, 5, 90, 190)] },
      previews: [{ clusterId: cluster.id, preview: { width: 100, height: 200 } }],
      excludes: [5, 7, 9],
    });
    const obj = JSON.parse(serializeCropSettings(settings)) as CropSettings;
    expect(obj).toEqual({
      excludes: [5, 7, 9],
      clusters: [
        {
          even: true,
          w: 595,
          h: 842,
          ratios: [[expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number)]],
        },
      ],
    });
    const ratios = obj.clusters[0]!.ratios[0]!;
    expect(ratios).toHaveLength(4);
    for (const v of ratios) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe("parseCropSettings validation", () => {
  it("rejects non-object roots", () => {
    expect(() => parseCropSettings("[]")).toThrow(/JSON object/);
    expect(() => parseCropSettings("null")).toThrow(/JSON object/);
    expect(() => parseCropSettings('"hi"')).toThrow(/JSON object/);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseCropSettings("{not json")).toThrow(/Invalid crop settings JSON/);
  });

  it("rejects a non-array clusters field", () => {
    expect(() => parseCropSettings('{"clusters": 3}')).toThrow(/clusters.*array/);
  });

  it("rejects a cluster entry with a non-boolean even", () => {
    expect(() => parseCropSettings('{"clusters":[{"even":"yes","w":1,"h":1,"ratios":[]}]}')).toThrow(/even.*boolean/);
  });

  it("rejects a ratio tuple that is not length 4", () => {
    expect(() => parseCropSettings('{"clusters":[{"even":true,"w":1,"h":1,"ratios":[[0.1,0.1]]}]}')).toThrow(
      /4-number array/,
    );
  });

  it("rejects a non-numeric ratio component", () => {
    expect(() => parseCropSettings('{"clusters":[{"even":true,"w":1,"h":1,"ratios":[[0.1,"x",0.1,0.1]]}]}')).toThrow(
      /finite number/,
    );
  });

  it("rejects a non-integer / non-positive excludes entry", () => {
    expect(() => parseCropSettings('{"excludes":[0]}')).toThrow(/positive integer/);
    expect(() => parseCropSettings('{"excludes":[1.5]}')).toThrow(/positive integer/);
  });

  it("defaults missing optional fields", () => {
    const settings = parseCropSettings("{}");
    expect(settings.excludes).toEqual([]);
    expect(settings.clusters).toEqual([]);
  });
});

describe("cropSettingsFileName", () => {
  it("appends .crop.json to the basename", () => {
    expect(cropSettingsFileName("report.pdf")).toBe("report.crop.json");
    expect(cropSettingsFileName("no-extension")).toBe("no-extension.crop.json");
    expect(cropSettingsFileName("a.b.c.pdf")).toBe("a.b.c.crop.json");
  });
});
