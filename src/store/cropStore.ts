import { create } from "zustand";
import { clamp, type PixelRect } from "@/lib/pdf/ratios";

export interface CropRect extends PixelRect {
  id: string;
}

interface ClusterCrops {
  [clusterId: string]: CropRect[];
}

export interface ClusterDims {
  imgW: number;
  imgH: number;
}

interface CropState {
  rectsByCluster: ClusterCrops;
  selectedClusterId: string | null;
  selectedRectId: string | null;
  syncSizes: boolean;
  setRects: (clusterId: string, rects: CropRect[]) => void;
  addRect: (clusterId: string, rect: CropRect) => void;
  updateRect: (clusterId: string, rectId: string, patch: Partial<CropRect>) => void;
  removeRect: (clusterId: string, rectId: string) => void;
  select: (clusterId: string | null, rectId: string | null) => void;
  clearAll: () => void;
  setSyncSizes: (v: boolean) => void;
  propagateSizeFromRect: (
    sourceClusterId: string,
    sourceRectId: string,
    dimsByCluster: Record<string, ClusterDims>,
  ) => void;
}

let nextId = 1;
export function newRectId(): string {
  return `rect-${nextId++}`;
}

export const useCropStore = create<CropState>((set) => ({
  rectsByCluster: {},
  selectedClusterId: null,
  selectedRectId: null,
  syncSizes: false,
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
    set({
      rectsByCluster: {},
      selectedClusterId: null,
      selectedRectId: null,
      syncSizes: false,
    }),
  setSyncSizes: (v) => set({ syncSizes: v }),
  propagateSizeFromRect: (sourceClusterId, sourceRectId, dimsByCluster) =>
    set((s) => {
      const sourceList = s.rectsByCluster[sourceClusterId] ?? [];
      const sourceRect = sourceList.find((r) => r.id === sourceRectId);
      const sourceDims = dimsByCluster[sourceClusterId];
      if (!sourceRect || !sourceDims || sourceDims.imgW <= 0 || sourceDims.imgH <= 0) {
        return {};
      }
      const wRatio = sourceRect.w / sourceDims.imgW;
      const hRatio = sourceRect.h / sourceDims.imgH;
      const newRectsByCluster: ClusterCrops = {};
      for (const [cid, list] of Object.entries(s.rectsByCluster)) {
        const dims = dimsByCluster[cid];
        if (!dims) {
          newRectsByCluster[cid] = list;
          continue;
        }
        const newW = wRatio * dims.imgW;
        const newH = hRatio * dims.imgH;
        const maxX = Math.max(0, dims.imgW - newW);
        const maxY = Math.max(0, dims.imgH - newH);
        newRectsByCluster[cid] = list.map((r) => {
          if (cid === sourceClusterId && r.id === sourceRectId) return r;
          return {
            ...r,
            x: clamp(r.x, 0, maxX),
            y: clamp(r.y, 0, maxY),
            w: newW,
            h: newH,
          };
        });
      }
      return { rectsByCluster: newRectsByCluster };
    }),
}));
