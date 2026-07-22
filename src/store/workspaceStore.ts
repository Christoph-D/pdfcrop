import { create } from "zustand";
import type { Cluster } from "@/lib/pdf/cluster";
import type { ClusterPreview } from "@/lib/pdf/render";
import { cropPdf, croppedFileName, type CropOutput } from "@/lib/pdf/write";
import type { PdfSource } from "@/lib/pdf/types";
import { useCropStore } from "./cropStore";

export type WorkspaceStatus = "idle" | "clustering" | "rendering" | "ready" | "cropping" | "error";

interface WorkspaceState {
  status: WorkspaceStatus;
  source: PdfSource | null;
  password: string | null;
  clusters: Cluster[];
  previews: ClusterPreview[];
  progressDone: number;
  progressTotal: number;
  error: string | null;
  lastCrop: (CropOutput & { fileName: string }) | null;
  setSource: (source: PdfSource, password: string | null) => void;
  setClusters: (clusters: Cluster[]) => void;
  setPreviews: (previews: ClusterPreview[]) => void;
  setStatus: (status: WorkspaceStatus) => void;
  setProgress: (done: number, total: number) => void;
  setError: (error: string) => void;
  cropAndSave: () => Promise<void>;
  reset: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  status: "idle",
  source: null,
  password: null,
  clusters: [],
  previews: [],
  progressDone: 0,
  progressTotal: 0,
  error: null,
  lastCrop: null,
  setSource: (source, password) => {
    useCropStore.getState().clearAll();
    set({ source, password, status: "clustering", error: null });
  },
  setClusters: (clusters) => set({ clusters }),
  setPreviews: (previews) => set({ previews, status: "ready" }),
  setStatus: (status) => set({ status }),
  setProgress: (progressDone, progressTotal) => set({ progressDone, progressTotal }),
  setError: (error) => set({ error, status: "error" }),
  cropAndSave: async () => {
    const state = get();
    if (!state.source) return;
    set({ status: "cropping", error: null });
    try {
      const cropStore = useCropStore.getState();
      const output = await cropPdf({
        source: state.source,
        password: state.password,
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
      password: null,
      clusters: [],
      previews: [],
      progressDone: 0,
      progressTotal: 0,
      error: null,
      lastCrop: null,
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
