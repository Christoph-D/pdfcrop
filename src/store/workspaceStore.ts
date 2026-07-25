import { create } from "zustand";
import { clusterPages, transferRectsBySize } from "@/lib/pdf/cluster";
import type { Cluster } from "@/lib/pdf/cluster";
import type { ClusterPreview } from "@/lib/pdf/render";
import {
  cropSettingsFileName,
  exportCropSettings,
  importCropSettings,
  parseCropSettings,
  serializeCropSettings,
} from "@/lib/pdf/cropSettings";
import { openBytesInTab, saveFile } from "@/lib/download";
import { cropPdf, croppedFileName, type CropOutput } from "@/lib/pdf/write";
import type { PdfSource } from "@/lib/pdf/types";
import { clamp } from "@/lib/pdf/ratios";
import { newRectId, useCropStore, type CropRect } from "./cropStore";

export type WorkspaceStatus = "idle" | "clustering" | "rendering" | "ready" | "cropping" | "error";

/** Zoom bounds and step, ported from BrissSwingGUI. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 10.0;
export const ZOOM_STEP = 1.25;
/** Fraction of the available window the auto-fit (zoom = 1) fills. */
export const FIT_PADDING = 0.95;

const clampZoom = (z: number): number => clamp(z, MIN_ZOOM, MAX_ZOOM);

interface WorkspaceState {
  status: WorkspaceStatus;
  source: PdfSource | null;
  clusters: Cluster[];
  /** Pages forced into singleton clusters (Briss "exclude pages"). */
  excludes: ReadonlySet<number>;
  /**
   * True while previews are re-rendering after a re-cluster. Keeps the
   * cropping view mounted (with placeholders) and its buttons disabled so the
   * user can't crop against stale previews.
   */
  isReclustering: boolean;
  previews: ClusterPreview[];
  progressDone: number;
  progressTotal: number;
  error: string | null;
  lastCrop: (CropOutput & { fileName: string }) | null;
  /**
   * Cached cropped bytes shared by the Preview and Download buttons. Reused
   * until invalidated (new PDF, re-cluster, or any crop-rect change) so
   * repeated clicks don't re-run `cropPdf`.
   */
  croppedCache: { bytes: Uint8Array; fileName: string } | null;
  /** Manual zoom factor. 1 = auto-fit; multiplied onto each panel's fit width. */
  zoom: number;
  lastImport: { matched: number; skipped: number } | null;
  setSource: (source: PdfSource) => void;
  setClusters: (clusters: Cluster[]) => void;
  setPreviews: (previews: ClusterPreview[]) => void;
  setStatus: (status: WorkspaceStatus) => void;
  setProgress: (done: number, total: number) => void;
  setError: (error: string) => void;
  setZoom: (zoom: number) => void;
  zoomBy: (factor: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  fitToWindow: () => void;
  reclusterWithExcludes: (excludes: ReadonlySet<number>) => void;
  /** Crop (or reuse the cached result) and open the PDF in a new tab. */
  cropPreview: () => Promise<void>;
  /** Crop (or reuse the cached result) and download it as `<name>_cropped.pdf`. */
  cropDownload: () => Promise<void>;
  /** Drop the cached cropped bytes (call from any change that invalidates it). */
  clearCroppedCache: () => void;
  exportCropSettings: () => Promise<void>;
  importCropSettings: (file: File) => Promise<void>;
  dismissImportNotice: () => void;
  reset: () => void;
}

const EMPTY_EXCLUDES: ReadonlySet<number> = new Set();

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  status: "idle",
  source: null,
  clusters: [],
  excludes: EMPTY_EXCLUDES,
  isReclustering: false,
  previews: [],
  progressDone: 0,
  progressTotal: 0,
  error: null,
  lastCrop: null,
  croppedCache: null,
  zoom: 1,
  lastImport: null,
  setSource: (source) => {
    useCropStore.getState().clearAll();
    set({
      source,
      excludes: EMPTY_EXCLUDES,
      clusters: clusterPages(source.pages, EMPTY_EXCLUDES),
      previews: [],
      status: "clustering",
      isReclustering: false,
      error: null,
      // A new document resets zoom to its auto-fit baseline and clears any
      // stale import notice, plus any cached crop from the previous file.
      zoom: 1,
      lastImport: null,
      croppedCache: null,
    });
  },
  setClusters: (clusters) => set({ clusters }),
  setPreviews: (previews) => set({ previews, status: "ready", isReclustering: false }),
  setStatus: (status) => set({ status }),
  setProgress: (progressDone, progressTotal) => set({ progressDone, progressTotal }),
  setError: (error) => set({ error, status: "error" }),
  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  zoomBy: (factor) => set((s) => ({ zoom: clampZoom(s.zoom * factor) })),
  zoomIn: () => set((s) => ({ zoom: clampZoom(s.zoom * ZOOM_STEP) })),
  zoomOut: () => set((s) => ({ zoom: clampZoom(s.zoom / ZOOM_STEP) })),
  // zoom = 1 is the auto-fit baseline, so reset and fit are the same target.
  resetZoom: () => set({ zoom: 1 }),
  fitToWindow: () => set({ zoom: 1 }),
  reclusterWithExcludes: (excludes) => {
    const state = get();
    if (!state.source) return;
    const next = new Set(excludes);
    const newClusters = clusterPages(state.source.pages, next);

    // Carry already-drawn crop rects over to the new clusters by matching
    // (parity, roundedW, roundedH). Runs here (not in the render effect) so it
    // happens exactly once per re-cluster — React StrictMode double-invokes
    // effects in dev, which would otherwise lose rects on the second pass.
    // Fresh ids avoid collisions when several old clusters collapse into one.
    const transferred = transferRectsBySize(state.clusters, newClusters, useCropStore.getState().rectsByCluster);
    const rectsByCluster: Record<string, CropRect[]> = {};
    for (const [clusterId, shapes] of Object.entries(transferred)) {
      rectsByCluster[clusterId] = shapes.map((s) => ({ id: newRectId(), ...s }));
    }
    useCropStore.getState().replaceAllRects(rectsByCluster);

    set({
      excludes: next,
      clusters: newClusters,
      previews: [],
      status: "ready",
      isReclustering: true,
      error: null,
      croppedCache: null,
    });
  },
  cropPreview: async () => {
    const state = get();
    if (!state.source) return;
    set({ status: "cropping", error: null });
    try {
      const { bytes } = await ensureCroppedBytes();
      // Open the cropped PDF in a new tab only now that the bytes are ready,
      // so users don't see a blank tab while cropping runs. Because cropping
      // crossed an `await`, this is no longer within the click's user gesture
      // and a popup blocker may suppress the tab; surface a clear error then.
      const tab = openBytesInTab(bytes, "application/pdf");
      if (!tab) {
        set({
          error: "Could not open the cropped PDF in a new tab. Allow pop-ups for this site, then try again.",
        });
      }
      set({ status: "ready" });
    } catch (err) {
      set({ status: "ready", error: err instanceof Error ? err.message : String(err) });
    }
  },
  cropDownload: async () => {
    const state = get();
    if (!state.source) return;
    set({ status: "cropping", error: null });
    try {
      const { bytes, fileName } = await ensureCroppedBytes();
      await saveFile(bytes, {
        suggestedName: fileName,
        mimeType: "application/pdf",
        extension: ".pdf",
        description: "Cropped PDF",
      });
      set({ status: "ready" });
    } catch (err) {
      set({ status: "ready", error: err instanceof Error ? err.message : String(err) });
    }
  },
  clearCroppedCache: () => set({ croppedCache: null }),
  exportCropSettings: async () => {
    const state = get();
    if (!state.source) return;
    try {
      const cropStore = useCropStore.getState();
      const settings = exportCropSettings({
        clusters: state.clusters,
        rectsByCluster: cropStore.rectsByCluster,
        previews: state.previews.map((p) => ({ clusterId: p.clusterId, preview: p.preview })),
      });
      const text = serializeCropSettings(settings);
      const bytes = new TextEncoder().encode(text);
      await saveFile(bytes, {
        suggestedName: cropSettingsFileName(state.source.fileName),
        mimeType: "application/json",
        extension: ".json",
        description: "Crop settings",
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
  importCropSettings: async (file) => {
    const state = get();
    if (!state.source) return;
    try {
      const text = await file.text();
      const settings = parseCropSettings(text);
      const result = importCropSettings(
        settings,
        state.clusters,
        state.previews.map((p) => ({ clusterId: p.clusterId, preview: p.preview })),
        newRectId,
      );
      const cropStore = useCropStore.getState();
      // Replace the rects of every matched cluster; leave unmatched clusters
      // untouched. Imported rects carry fresh ids, so drop any stale selection.
      for (const [clusterId, rects] of Object.entries(result.rectsByCluster)) {
        cropStore.setRects(clusterId, rects);
      }
      cropStore.clearSelection();
      set({
        error: null,
        lastImport: { matched: result.matched, skipped: result.skipped },
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
  dismissImportNotice: () => set({ lastImport: null }),
  reset: () =>
    set({
      status: "idle",
      source: null,
      clusters: [],
      excludes: EMPTY_EXCLUDES,
      isReclustering: false,
      previews: [],
      progressDone: 0,
      progressTotal: 0,
      error: null,
      lastCrop: null,
      zoom: 1,
      lastImport: null,
      croppedCache: null,
    }),
}));

/**
 * Return the cropped PDF bytes, computing them once and caching the result so
 * repeated Preview/Download clicks don't re-run `cropPdf`. Both buttons share
 * this single cache; it is cleared whenever the source, clusters, or any crop
 * rectangle changes (see `clearCroppedCache` callers).
 */
async function ensureCroppedBytes(): Promise<{ bytes: Uint8Array; fileName: string }> {
  const { source, clusters, previews, croppedCache } = useWorkspaceStore.getState();
  if (croppedCache) return croppedCache;
  const cropStore = useCropStore.getState();
  const output = await cropPdf({
    source: source!,
    clusters,
    rectsByCluster: cropStore.rectsByCluster,
    previews: previews.map((p) => ({ clusterId: p.clusterId, preview: p.preview })),
  });
  const fileName = croppedFileName(source!.fileName);
  useWorkspaceStore.setState({
    croppedCache: { bytes: output.bytes, fileName },
    lastCrop: { ...output, fileName },
  });
  return { bytes: output.bytes, fileName };
}
