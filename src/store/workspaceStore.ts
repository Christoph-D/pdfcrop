import { create } from "zustand";
import type { Cluster } from "@/lib/pdf/cluster";
import type { ClusterPreview } from "@/lib/pdf/render";
import { cropPdf, croppedFileName, type CropOutput } from "@/lib/pdf/write";
import type { PdfSource } from "@/lib/pdf/types";
import { clamp } from "@/lib/pdf/ratios";
import { useCropStore } from "./cropStore";

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
  setSource: (source) => {
    useCropStore.getState().clearAll();
    // A new document resets zoom to its auto-fit baseline.
    set({ source, status: "clustering", error: null, zoom: 1 });
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
      await triggerDownload(output.bytes, fileName);
      set({ status: "ready", lastCrop: { ...output, fileName } });
    } catch (err) {
      set({
        status: "ready",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
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
    }),
}));

async function triggerDownload(bytes: Uint8Array, fileName: string): Promise<void> {
  // Copy into a fresh ArrayBuffer so DOM type-checkers are happy with Blob /
  // BufferSource (Uint8Array<ArrayBufferLike> may also wrap SharedArrayBuffer).
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  // Try the File System Access API save picker first, fall back to a download.
  const w = window as unknown as {
    showSaveFilePicker?: (opts: {
      suggestedName?: string;
      types?: Array<{ description?: string; accept: Record<string, string[]> }>;
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: BufferSource) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  };
  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: "PDF",
            accept: { "application/pdf": [".pdf"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(buffer);
      await writable.close();
      return;
    } catch (err) {
      if (err instanceof DOMException && (err.name === "AbortError" || err.name === "NotAllowedError")) {
        return; // user cancelled
      }
      // fall through to download
    }
  }
  const blob = new Blob([buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
