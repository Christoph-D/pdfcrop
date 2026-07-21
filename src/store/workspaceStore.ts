import { create } from "zustand";
import type { Cluster } from "@/lib/pdf/cluster";
import type { ClusterPreview } from "@/lib/pdf/render";
import type { PdfSource } from "@/lib/pdf/types";

export type WorkspaceStatus =
  | "idle"
  | "clustering"
  | "rendering"
  | "ready"
  | "error";

interface WorkspaceState {
  status: WorkspaceStatus;
  source: PdfSource | null;
  password: string | null;
  clusters: Cluster[];
  previews: ClusterPreview[];
  progressDone: number;
  progressTotal: number;
  error: string | null;
  setSource: (source: PdfSource, password: string | null) => void;
  setClusters: (clusters: Cluster[]) => void;
  setPreviews: (previews: ClusterPreview[]) => void;
  setStatus: (status: WorkspaceStatus) => void;
  setProgress: (done: number, total: number) => void;
  setError: (error: string) => void;
  reset: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  status: "idle",
  source: null,
  password: null,
  clusters: [],
  previews: [],
  progressDone: 0,
  progressTotal: 0,
  error: null,
  setSource: (source, password) =>
    set({ source, password, status: "clustering", error: null }),
  setClusters: (clusters) => set({ clusters }),
  setStatus: (status) => set({ status }),
  setPreviews: (previews) => set({ previews, status: "ready" }),
  setProgress: (progressDone, progressTotal) => set({ progressDone, progressTotal }),
  setError: (error) => set({ error, status: "error" }),
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
    }),
}));
