import { create } from "zustand";
import { clamp, type PixelRect } from "@/lib/pdf/ratios";
import { useWorkspaceStore } from "./workspaceStore";

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

/**
 * Which edges of a rect stay fixed when its size changes during sync
 * propagation. Mirrors the corner/edge the user dragged on the source.
 */
export interface SizeAnchor {
  fixedLeft: boolean;
  fixedTop: boolean;
}

/**
 * A relative geometry change applied uniformly to every selected rect,
 * regardless of cluster. Mirrors Briss's `moveSelectedRects` /
 * `resizeSelRects` / `resizeAndMoveSelectedRects` broadcast model: the same
 * delta reaches all selected rects.
 */
export interface RectDelta {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

interface CropState {
  rectsByCluster: ClusterCrops;
  /** Global multi-select across all cluster panels. */
  selectedRectIds: Set<string>;
  /** The cluster the user last interacted with (paste target). */
  activeClusterId: string | null;
  syncSizes: boolean;
  /** In-memory clipboard for copying crop-rect layouts between clusters. */
  clipboard: PixelRect[];
  setRects: (clusterId: string, rects: CropRect[]) => void;
  addRect: (clusterId: string, rect: CropRect) => void;
  updateRect: (clusterId: string, rectId: string, patch: Partial<CropRect>) => void;
  removeRect: (clusterId: string, rectId: string) => void;
  /** Replace a single rect with N rects (e.g. a split), preserving array order. */
  replaceRect: (clusterId: string, rectId: string, replacements: CropRect[]) => void;
  /**
   * Replace the entire per-cluster rect map (used when re-clustering, where
   * cluster ids change). Resets selection since rect ids no longer match.
   */
  replaceAllRects: (rectsByCluster: ClusterCrops) => void;
  /** Shift+click: toggle a single rect's membership in the selection. */
  toggleSelect: (rectId: string) => void;
  /** Plain click: replace the selection with a single rect. */
  selectOnly: (rectId: string) => void;
  /** Deselect everything (Esc / empty-area click). */
  clearSelection: () => void;
  /** Delete every selected rect across all clusters. */
  removeSelectedRects: () => void;
  /**
   * Apply a delta to every selected rect other than `exceptRectId` (the one
   * being dragged, which the panel updates directly). Each rect is moved from
   * its captured `origins` position and clamped to its cluster's image bounds.
   */
  applyDeltaToSelectionExcept: (
    exceptRectId: string,
    delta: RectDelta,
    origins: Record<string, PixelRect>,
    dimsByCluster: Record<string, ClusterDims>,
  ) => void;
  /**
   * Apply a delta to every selected rect, each from its own current position
   * and clamped to its cluster's image bounds. Used by keyboard nudging (arrow
   * keys), where each keypress is an independent move/resize from the current
   * geometry rather than a continuous drag from a captured origin. Mirrors
   * Briss's `moveSelectedRects` / `resizeSelRects`.
   */
  applyDeltaToSelection: (delta: RectDelta, dimsByCluster: Record<string, ClusterDims>) => void;
  /** Mark a cluster as the paste target (set on pointer-down). */
  setActiveCluster: (clusterId: string) => void;
  /** Replace the clipboard with the currently selected rects (clears first). */
  copy: () => void;
  /** Append copies of the clipboard rects to `clusterId`, starting unselected. */
  paste: (clusterId: string) => void;
  clearAll: () => void;
  setSyncSizes: (v: boolean) => void;
  propagateSizeFromRect: (
    sourceClusterId: string,
    sourceRectId: string,
    dimsByCluster: Record<string, ClusterDims>,
    anchor: SizeAnchor,
  ) => void;
  /**
   * Snap every selected rect (across all clusters) to a reference rect's
   * x/y/w/h. Mirrors Briss's `BrissGUIApp.alignSelRects`: the context menu
   * passes the rect under the cursor and every selected rect is moved and
   * resized to match it. Each rect is clamped into its own cluster's image
   * bounds so a differing-size cluster can't push a rect off its preview.
   */
  alignSelectedRects: (reference: PixelRect, dimsByCluster: Record<string, ClusterDims>) => void;
}

let nextId = 1;
export function newRectId(): string {
  return `rect-${nextId++}`;
}

/**
 * Drop the cached cropped PDF. Called from every cropStore mutator that would
 * change the cropped output (any add / move / resize / delete / split /
 * replace of a rect). Selection-only changes intentionally leave the cache
 * intact, since the same rectangles produce the same cropped PDF regardless
 * of which are selected.
 */
function invalidateCropCache(): void {
  useWorkspaceStore.getState().clearCroppedCache();
}

/** Clamp a rect moved by `delta` from `orig` into a `imgW` x `imgH` box. */
function moveRectByDelta(rect: CropRect, orig: PixelRect, delta: RectDelta, imgW: number, imgH: number): CropRect {
  const w = clamp(orig.w + delta.dw, 1, imgW);
  const h = clamp(orig.h + delta.dh, 1, imgH);
  const x = clamp(orig.x + delta.dx, 0, Math.max(0, imgW - w));
  const y = clamp(orig.y + delta.dy, 0, Math.max(0, imgH - h));
  return { ...rect, x, y, w, h };
}

export const useCropStore = create<CropState>((set) => ({
  rectsByCluster: {},
  selectedRectIds: new Set(),
  activeClusterId: null,
  syncSizes: false,
  clipboard: [],
  setRects: (clusterId, rects) => {
    invalidateCropCache();
    return set((s) => ({
      rectsByCluster: { ...s.rectsByCluster, [clusterId]: rects },
    }));
  },
  addRect: (clusterId, rect) => {
    invalidateCropCache();
    return set((s) => ({
      rectsByCluster: {
        ...s.rectsByCluster,
        [clusterId]: [...(s.rectsByCluster[clusterId] ?? []), rect],
      },
    }));
  },
  updateRect: (clusterId, rectId, patch) => {
    invalidateCropCache();
    return set((s) => {
      const list = s.rectsByCluster[clusterId] ?? [];
      return {
        rectsByCluster: {
          ...s.rectsByCluster,
          [clusterId]: list.map((r) => (r.id === rectId ? { ...r, ...patch } : r)),
        },
      };
    });
  },
  removeRect: (clusterId, rectId) => {
    invalidateCropCache();
    return set((s) => {
      const list = s.rectsByCluster[clusterId] ?? [];
      if (!s.selectedRectIds.has(rectId) && !list.some((r) => r.id === rectId)) return {};
      const selectedRectIds = new Set(s.selectedRectIds);
      selectedRectIds.delete(rectId);
      return {
        rectsByCluster: {
          ...s.rectsByCluster,
          [clusterId]: list.filter((r) => r.id !== rectId),
        },
        selectedRectIds,
      };
    });
  },
  replaceRect: (clusterId, rectId, replacements) => {
    invalidateCropCache();
    return set((s) => {
      const list = s.rectsByCluster[clusterId] ?? [];
      const idx = list.findIndex((r) => r.id === rectId);
      if (idx === -1) return {};
      // If the replaced rect was selected, drop it from the selection.
      const selectedRectIds = new Set(s.selectedRectIds);
      selectedRectIds.delete(rectId);
      return {
        rectsByCluster: {
          ...s.rectsByCluster,
          [clusterId]: [...list.slice(0, idx), ...replacements, ...list.slice(idx + 1)],
        },
        selectedRectIds,
      };
    });
  },
  replaceAllRects: (rectsByCluster) => {
    invalidateCropCache();
    return set({ rectsByCluster, selectedRectIds: new Set() });
  },
  toggleSelect: (rectId) =>
    set((s) => {
      const selectedRectIds = new Set(s.selectedRectIds);
      if (selectedRectIds.has(rectId)) selectedRectIds.delete(rectId);
      else selectedRectIds.add(rectId);
      return { selectedRectIds };
    }),
  selectOnly: (rectId) => set({ selectedRectIds: new Set([rectId]) }),
  clearSelection: () => set({ selectedRectIds: new Set() }),
  removeSelectedRects: () => {
    invalidateCropCache();
    return set((s) => {
      if (s.selectedRectIds.size === 0) return {};
      const rectsByCluster: ClusterCrops = {};
      for (const [cid, list] of Object.entries(s.rectsByCluster)) {
        rectsByCluster[cid] = list.filter((r) => !s.selectedRectIds.has(r.id));
      }
      return { rectsByCluster, selectedRectIds: new Set() };
    });
  },
  applyDeltaToSelectionExcept: (exceptRectId, delta, origins, dimsByCluster) => {
    invalidateCropCache();
    return set((s) => {
      let hasOther = false;
      for (const id of s.selectedRectIds) {
        if (id !== exceptRectId) {
          hasOther = true;
          break;
        }
      }
      if (!hasOther) return {};
      const rectsByCluster: ClusterCrops = {};
      for (const [cid, list] of Object.entries(s.rectsByCluster)) {
        const dims = dimsByCluster[cid];
        const imgW = dims?.imgW ?? Number.POSITIVE_INFINITY;
        const imgH = dims?.imgH ?? Number.POSITIVE_INFINITY;
        rectsByCluster[cid] = list.map((r) => {
          if (r.id === exceptRectId || !s.selectedRectIds.has(r.id)) return r;
          const orig = origins[r.id] ?? r;
          return moveRectByDelta(r, orig, delta, imgW, imgH);
        });
      }
      return { rectsByCluster };
    });
  },
  applyDeltaToSelection: (delta, dimsByCluster) => {
    invalidateCropCache();
    return set((s) => {
      if (s.selectedRectIds.size === 0) return {};
      const rectsByCluster: ClusterCrops = {};
      for (const [cid, list] of Object.entries(s.rectsByCluster)) {
        // Preserve array identity for clusters with no selected rect so
        // unaffected panels don't needlessly re-render.
        if (!list.some((r) => s.selectedRectIds.has(r.id))) {
          rectsByCluster[cid] = list;
          continue;
        }
        const dims = dimsByCluster[cid];
        const imgW = dims?.imgW ?? Number.POSITIVE_INFINITY;
        const imgH = dims?.imgH ?? Number.POSITIVE_INFINITY;
        // Each rect moves from its own current geometry (origin = rect).
        rectsByCluster[cid] = list.map((r) =>
          s.selectedRectIds.has(r.id) ? moveRectByDelta(r, r, delta, imgW, imgH) : r,
        );
      }
      return { rectsByCluster };
    });
  },
  setActiveCluster: (clusterId) => set({ activeClusterId: clusterId }),
  copy: () =>
    set((s) => {
      // Mirrors Briss's copyToClipBoard: clear first, then snapshot the
      // geometry of every selected rect (across all clusters).
      const clip: PixelRect[] = [];
      for (const list of Object.values(s.rectsByCluster)) {
        for (const r of list) {
          if (s.selectedRectIds.has(r.id)) clip.push({ x: r.x, y: r.y, w: r.w, h: r.h });
        }
      }
      return { clipboard: clip };
    }),
  paste: (clusterId) => {
    invalidateCropCache();
    return set((s) => {
      if (s.clipboard.length === 0) return {};
      // Mirrors Briss's pasteFromClipBoard: append brand-new rects that copy
      // the geometry but start unselected (new id, selection left untouched).
      const pasted: CropRect[] = s.clipboard.map(({ x, y, w, h }) => ({
        id: newRectId(),
        x,
        y,
        w,
        h,
      }));
      return {
        rectsByCluster: {
          ...s.rectsByCluster,
          [clusterId]: [...(s.rectsByCluster[clusterId] ?? []), ...pasted],
        },
      };
    });
  },
  clearAll: () => {
    invalidateCropCache();
    return set({
      rectsByCluster: {},
      selectedRectIds: new Set(),
      activeClusterId: null,
      syncSizes: false,
      clipboard: [],
    });
  },
  setSyncSizes: (v) => set({ syncSizes: v }),
  propagateSizeFromRect: (sourceClusterId, sourceRectId, dimsByCluster, anchor) => {
    invalidateCropCache();
    return set((s) => {
      const sourceList = s.rectsByCluster[sourceClusterId] ?? [];
      const sourceRect = sourceList.find((r) => r.id === sourceRectId);
      const sourceDims = dimsByCluster[sourceClusterId];
      if (!sourceRect || !sourceDims || sourceDims.imgW <= 0 || sourceDims.imgH <= 0) {
        return {};
      }
      const wRatio = sourceRect.w / sourceDims.imgW;
      const hRatio = sourceRect.h / sourceDims.imgH;
      const { fixedLeft, fixedTop } = anchor;
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
          const rawX = fixedLeft ? r.x : r.x + r.w - newW;
          const rawY = fixedTop ? r.y : r.y + r.h - newH;
          return {
            ...r,
            x: clamp(rawX, 0, maxX),
            y: clamp(rawY, 0, maxY),
            w: newW,
            h: newH,
          };
        });
      }
      return { rectsByCluster: newRectsByCluster };
    });
  },
  alignSelectedRects: (reference, dimsByCluster) => {
    invalidateCropCache();
    return set((s) => {
      if (s.selectedRectIds.size === 0) return {};
      const { x: rx, y: ry, w: rw, h: rh } = reference;
      let changed = false;
      const rectsByCluster: ClusterCrops = {};
      for (const [cid, list] of Object.entries(s.rectsByCluster)) {
        if (!list.some((r) => s.selectedRectIds.has(r.id))) {
          rectsByCluster[cid] = list;
          continue;
        }
        const dims = dimsByCluster[cid];
        const imgW = dims?.imgW ?? Number.POSITIVE_INFINITY;
        const imgH = dims?.imgH ?? Number.POSITIVE_INFINITY;
        const w = clamp(rw, 1, imgW);
        const h = clamp(rh, 1, imgH);
        const x = clamp(rx, 0, Math.max(0, imgW - w));
        const y = clamp(ry, 0, Math.max(0, imgH - h));
        changed = true;
        rectsByCluster[cid] = list.map((r) => (s.selectedRectIds.has(r.id) ? { ...r, x, y, w, h } : r));
      }
      return changed ? { rectsByCluster } : {};
    });
  },
}));
