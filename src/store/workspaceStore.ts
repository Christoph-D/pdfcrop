import { create } from "zustand";
import type { Cluster } from "@/lib/pdf/cluster";
import type { ClusterPreview } from "@/lib/pdf/render";
import {
  cropSettingsFileName,
  exportCropSettings,
  importCropSettings,
  parseCropSettings,
  serializeCropSettings,
} from "@/lib/pdf/cropSettings";
import { saveFile } from "@/lib/download";
import { cropPdf, croppedFileName, type CropOutput } from "@/lib/pdf/write";
import type { PdfSource } from "@/lib/pdf/types";
import { clamp } from "@/lib/pdf/ratios";
import { newRectId, useCropStore } from "./cropStore";

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
  previews: ClusterPreview[];
  progressDone: number;
  progressTotal: number;
  error: string | null;
  lastCrop: (CropOutput & { fileName: string }) | null;
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
  cropAndSave: () => Promise<void>;
  exportCropSettings: () => Promise<void>;
  importCropSettings: (file: File) => Promise<void>;
  dismissImportNotice: () => void;
  reset: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  status: "idle",
  source: null,
  clusters: [],
  previews: [],
  progressDone: 0,
  progressTotal: 0,
  error: null,
  lastCrop: null,
  zoom: 1,
  lastImport: null,
  setSource: (source) => {
    useCropStore.getState().clearAll();
    // A new document resets zoom to its auto-fit baseline and clears any
    // stale import notice.
    set({ source, status: "clustering", error: null, zoom: 1, lastImport: null });
  },
  setClusters: (clusters) => set({ clusters }),
  setPreviews: (previews) => set({ previews, status: "ready" }),
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
  cropAndSave: async () => {
    const state = get();
    if (!state.source) return;
    set({ status: "cropping", error: null });
    try {
      const cropStore = useCropStore.getState();
      const output = await cropPdf({
        source: state.source,
        clusters: state.clusters,
        rectsByCluster: cropStore.rectsByCluster,
        previews: state.previews.map((p) => ({
          clusterId: p.clusterId,
          preview: p.preview,
        })),
      });
      const fileName = croppedFileName(state.source.fileName);
      await saveFile(output.bytes, {
        suggestedName: fileName,
        mimeType: "application/pdf",
        extension: ".pdf",
        description: "PDF",
      });
      set({ status: "ready", lastCrop: { ...output, fileName } });
    } catch (err) {
      set({
        status: "ready",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
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
      previews: [],
      progressDone: 0,
      progressTotal: 0,
      error: null,
      lastCrop: null,
      zoom: 1,
      lastImport: null,
    }),
}));
