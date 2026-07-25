import { roundSize, type Cluster, type Parity } from "./cluster";
import { clamp, pixelRectToRatios, ratiosToPixelRect, type Ratios } from "./ratios";
import type { CropRect } from "@/store/cropStore";

/** A single cluster's persisted crop ratios, plus the identity used to match it. */
export interface CropClusterEntry {
  /** Page parity: true for even pages, false for odd. */
  even: boolean;
  /** Representative page width in PDF units (matched after rounding). */
  w: number;
  /** Representative page height in PDF units (matched after rounding). */
  h: number;
  /** One [left, bottom, right, top] margin ratio tuple per crop rectangle. */
  ratios: number[][];
}

/**
 * Serialized crop layout. Re-applicable to a related PDF by re-clustering and
 * matching each entry to a live cluster by `(parity, roundedW, roundedH)`.
 *
 * This is the persisted counterpart of Briss's (never-shipped)
 * `ExportImportHelper`; JSON replaces the original space-delimited text format.
 */
export interface CropSettings {
  /** Excluded page numbers (reserved for the exclude-pages feature). */
  excludes: number[];
  clusters: CropClusterEntry[];
}

export interface CropPreviewDim {
  clusterId: string;
  preview: { width: number; height: number };
}

export interface ExportCropSettingsInput {
  clusters: Cluster[];
  rectsByCluster: Record<string, CropRect[]>;
  previews: CropPreviewDim[];
  /** Excluded page numbers to persist (defaults to none). */
  excludes?: number[];
}

/** Factory used to mint fresh rect ids when re-applying imported ratios. */
export type RectIdFactory = () => string;

function parityToEven(parity: Parity): boolean {
  return parity === "even";
}

function evenToParity(even: boolean): Parity {
  return even ? "even" : "odd";
}

/**
 * Build a serializable CropSettings snapshot from the current crop layout.
 * Pure: does not touch the DOM or stores.
 */
export function exportCropSettings(input: ExportCropSettingsInput): CropSettings {
  const previewByCluster = new Map(input.previews.map((p) => [p.clusterId, p.preview]));
  const clusters: CropClusterEntry[] = input.clusters.map((cluster) => {
    const preview = previewByCluster.get(cluster.id);
    const rects = input.rectsByCluster[cluster.id] ?? [];
    const ratios = rects.map((rect) => {
      if (!preview) return [0, 0, 0, 0];
      const r = pixelRectToRatios(rect, preview.width, preview.height);
      return [r[0], r[1], r[2], r[3]];
    });
    return {
      even: parityToEven(cluster.parity),
      w: cluster.width,
      h: cluster.height,
      ratios,
    };
  });
  return {
    excludes: input.excludes ? [...input.excludes] : [],
    clusters,
  };
}

export interface ImportCropSettingsResult {
  /** Map of live cluster id -> re-applied pixel-space crop rects. */
  rectsByCluster: Record<string, CropRect[]>;
  /** Number of file entries that matched a live cluster. */
  matched: number;
  /** Number of file entries with no matching live cluster (skipped). */
  skipped: number;
}

/**
 * Match saved cluster entries to live clusters by `(parity, roundedW,
 * roundedH)` and convert their ratios back into pixel-space rects sized for
 * each live cluster's preview. Entries without a match are skipped safely.
 *
 * Ratios are resolution-independent, so the same settings re-apply correctly
 * even when the target PDF's previews render at a different scale.
 *
 * Pure: callers are responsible for writing `rectsByCluster` into the store.
 */
export function importCropSettings(
  settings: CropSettings,
  liveClusters: Cluster[],
  previews: CropPreviewDim[],
  idFactory: RectIdFactory,
): ImportCropSettingsResult {
  const previewByCluster = new Map(previews.map((p) => [p.clusterId, p.preview]));
  const liveByKey = new Map<string, Cluster>();
  for (const c of liveClusters) liveByKey.set(c.id, c);

  const rectsByCluster: Record<string, CropRect[]> = {};
  let matched = 0;
  let skipped = 0;

  for (const entry of settings.clusters) {
    // Same key shape produced by clusterPages / clusterKey.
    const key = `${evenToParity(entry.even)}|${roundSize(entry.w)}|${roundSize(entry.h)}`;
    const cluster = liveByKey.get(key);
    if (!cluster) {
      skipped += 1;
      continue;
    }
    const preview = previewByCluster.get(cluster.id);
    if (!preview) {
      skipped += 1;
      continue;
    }
    const rects: CropRect[] = entry.ratios
      .map((r) => normalizeRatios(r))
      .map((r) => ratiosToPixelRect(r, preview.width, preview.height))
      .map((px) => ({ id: idFactory(), x: px.x, y: px.y, w: px.w, h: px.h }));
    rectsByCluster[cluster.id] = rects;
    matched += 1;
  }

  return { rectsByCluster, matched, skipped };
}

function normalizeRatios(r: number[]): Ratios {
  return [clampNum(r[0]), clampNum(r[1]), clampNum(r[2]), clampNum(r[3])];
}

function clampNum(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return clamp(n, 0, 1);
}

/** Serialize crop settings to a pretty-printed JSON string. */
export function serializeCropSettings(settings: CropSettings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/**
 * Parse and validate a crop-settings JSON string. Throws a descriptive Error
 * on malformed input so the UI can surface it in the error banner.
 */
export function parseCropSettings(text: string): CropSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid crop settings JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return normalizeSettings(raw);
}

function normalizeSettings(raw: unknown): CropSettings {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Crop settings must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  return {
    excludes: normalizeExcludes(obj.excludes),
    clusters: normalizeClusters(obj.clusters),
  };
}

function normalizeExcludes(raw: unknown): number[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('Crop settings "excludes" must be an array of page numbers');
  }
  return raw.map((v, i) => {
    if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v < 1) {
      throw new Error(`Crop settings "excludes[${i}]" must be a positive integer`);
    }
    return v;
  });
}

function normalizeClusters(raw: unknown): CropClusterEntry[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error('Crop settings "clusters" must be an array');
  }
  return raw.map((entry, i) => normalizeClusterEntry(entry, i));
}

function normalizeClusterEntry(raw: unknown, index: number): CropClusterEntry {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Crop settings "clusters[${index}]" must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  const { even, w, h, ratios } = obj;
  if (typeof even !== "boolean") {
    throw new Error(`Crop settings "clusters[${index}].even" must be a boolean`);
  }
  if (typeof w !== "number" || !Number.isFinite(w) || w < 0) {
    throw new Error(`Crop settings "clusters[${index}].w" must be a non-negative number`);
  }
  if (typeof h !== "number" || !Number.isFinite(h) || h < 0) {
    throw new Error(`Crop settings "clusters[${index}].h" must be a non-negative number`);
  }
  if (!Array.isArray(ratios)) {
    throw new Error(`Crop settings "clusters[${index}].ratios" must be an array`);
  }
  return {
    even,
    w,
    h,
    ratios: ratios.map((r, j) => normalizeRatioTuple(r, index, j)),
  };
}

function normalizeRatioTuple(raw: unknown, ci: number, ri: number): number[] {
  if (!Array.isArray(raw) || raw.length !== 4) {
    throw new Error(`Crop settings "clusters[${ci}].ratios[${ri}]" must be a 4-number array`);
  }
  return raw.map((v, k) => {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`Crop settings "clusters[${ci}].ratios[${ri}][${k}]" must be a finite number`);
    }
    return clamp(v, 0, 1);
  });
}

/** Build a default crop-settings filename: `<basename>.crop.json`. */
export function cropSettingsFileName(original: string): string {
  const dot = original.lastIndexOf(".");
  const stem = dot > 0 ? original.slice(0, dot) : original;
  return `${stem}.crop.json`;
}
