import { create } from "zustand";
import type { PixelRect } from "@/lib/pdf/ratios";

export interface CropRect extends PixelRect {
  id: string;
}

interface ClusterCrops {
  [clusterId: string]: CropRect[];
}

interface CropState {
  rectsByCluster: ClusterCrops;
  selectedClusterId: string | null;
  selectedRectId: string | null;
  setRects: (clusterId: string, rects: CropRect[]) => void;
  addRect: (clusterId: string, rect: CropRect) => void;
  updateRect: (clusterId: string, rectId: string, patch: Partial<CropRect>) => void;
  removeRect: (clusterId: string, rectId: string) => void;
  select: (clusterId: string | null, rectId: string | null) => void;
  clearAll: () => void;
}

let nextId = 1;
export function newRectId(): string {
  return `rect-${nextId++}`;
}

export const useCropStore = create<CropState>((set) => ({
  rectsByCluster: {},
  selectedClusterId: null,
  selectedRectId: null,
  setRects: (clusterId, rects) =>
    set((s) => ({
      rectsByCluster: { ...s.rectsByCluster, [clusterId]: rects },
    })),
  addRect: (clusterId, rect) =>
    set((s) => ({
      rectsByCluster: {
        ...s.rectsByCluster,
        [clusterId]: [...(s.rectsByCluster[clusterId] ?? []), rect],
      },
    })),
  updateRect: (clusterId, rectId, patch) =>
    set((s) => {
      const list = s.rectsByCluster[clusterId] ?? [];
      return {
        rectsByCluster: {
          ...s.rectsByCluster,
          [clusterId]: list.map((r) =>
            r.id === rectId ? { ...r, ...patch } : r,
          ),
        },
      };
    }),
  removeRect: (clusterId, rectId) =>
    set((s) => {
      const list = s.rectsByCluster[clusterId] ?? [];
      return {
        rectsByCluster: {
          ...s.rectsByCluster,
          [clusterId]: list.filter((r) => r.id !== rectId),
        },
        selectedRectId: s.selectedRectId === rectId ? null : s.selectedRectId,
        selectedClusterId:
          s.selectedClusterId === clusterId && s.selectedRectId === rectId
            ? null
            : s.selectedClusterId,
      };
    }),
  select: (clusterId, rectId) =>
    set({ selectedClusterId: clusterId, selectedRectId: rectId }),
  clearAll: () =>
    set({ rectsByCluster: {}, selectedClusterId: null, selectedRectId: null }),
}));
