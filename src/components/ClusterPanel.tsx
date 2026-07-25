import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { Cluster } from "@/lib/pdf/cluster";
import type { GrayImage } from "@/lib/pdf/overlay";
import { getAutoCropRatios } from "@/lib/pdf/autocrop";
import { splitColumn, splitRow } from "@/lib/pdf/split";
import {
  CORNER_DIMENSION,
  EDGE_THRESHOLD,
  SELECTABLE_CORNER_DIMENSION,
  hasEnoughSpaceForHandles,
  type PixelRect,
  ratiosToPixelRect,
} from "@/lib/pdf/ratios";
import { formatCropSizeLabel } from "@/lib/pdf/units";
import { FIT_PADDING, useWorkspaceStore } from "@/store/workspaceStore";
import { newRectId, useCropStore, type CropRect, type RectDelta, type SizeAnchor } from "@/store/cropStore";
import "./ClusterPanel.css";

type Handle = "move" | "nw" | "ne" | "sw" | "se" | "edge-n" | "edge-s" | "edge-e" | "edge-w" | "draw";

interface Props {
  cluster: Cluster;
  preview: GrayImage;
  previewUrl: string;
}

function hitTest(rect: PixelRect, px: number, py: number, selected: boolean): Handle | null {
  const handleHit = SELECTABLE_CORNER_DIMENSION / 2;
  const edgeHit = EDGE_THRESHOLD;
  const x1 = rect.x;
  const y1 = rect.y;
  const x2 = rect.x + rect.w;
  const y2 = rect.y + rect.h;
  if (selected) {
    if (Math.abs(px - x1) < handleHit && Math.abs(py - y1) < handleHit) return "nw";
    if (Math.abs(px - x2) < handleHit && Math.abs(py - y2) < handleHit) return "se";
    if (Math.abs(px - x2) < handleHit && Math.abs(py - y1) < handleHit) return "ne";
    if (Math.abs(px - x1) < handleHit && Math.abs(py - y2) < handleHit) return "sw";
    if (Math.abs(py - y1) < edgeHit && px >= x1 && px <= x2) return "edge-n";
    if (Math.abs(py - y2) < edgeHit && px >= x1 && px <= x2) return "edge-s";
    if (Math.abs(px - x2) < edgeHit && py >= y1 && py <= y2) return "edge-e";
    if (Math.abs(px - x1) < edgeHit && py >= y1 && py <= y2) return "edge-w";
  }
  if (px >= x1 && px <= x2 && py >= y1 && py <= y2) return "move";
  return null;
}

function cursorFor(handle: Handle | null): string {
  switch (handle) {
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "edge-n":
    case "edge-s":
      return "ns-resize";
    case "edge-e":
    case "edge-w":
      return "ew-resize";
    case "move":
      return "move";
    case "draw":
      return "crosshair";
    default:
      return "crosshair";
  }
}

/**
 * Which edges of a rect stay fixed when its size changes, mirroring the
 * corner/edge the user dragged. For edge handles the perpendicular axis is
 * unchanged, so its anchor flag is irrelevant (defaults to fixed).
 */
function anchorForHandle(handle: Handle): SizeAnchor {
  switch (handle) {
    case "nw":
      return { fixedLeft: false, fixedTop: false };
    case "ne":
      return { fixedLeft: true, fixedTop: false };
    case "sw":
      return { fixedLeft: false, fixedTop: true };
    case "se":
    case "edge-e":
    case "edge-s":
      return { fixedLeft: true, fixedTop: true };
    case "edge-n":
      return { fixedLeft: true, fixedTop: false };
    case "edge-w":
      return { fixedLeft: false, fixedTop: true };
    default:
      return { fixedLeft: true, fixedTop: true };
  }
}

/**
 * Translate a mouse delta (from drag start) into the per-axis geometry delta
 * for a given handle. This is the broadcast mapping: every selected rect
 * receives the same `{dx, dy, dw, dh}` regardless of which cluster it lives in.
 * Mirrors Briss's moveSelectedRects / resizeSelRects / resizeAndMoveSelectedRects.
 */
function deltaForHandle(handle: Handle, dx: number, dy: number): RectDelta {
  switch (handle) {
    case "move":
      return { dx, dy, dw: 0, dh: 0 };
    case "nw":
      return { dx, dy, dw: -dx, dh: -dy };
    case "ne":
      return { dx: 0, dy, dw: dx, dh: -dy };
    case "sw":
      return { dx, dy: 0, dw: -dx, dh: dy };
    case "se":
      return { dx: 0, dy: 0, dw: dx, dh: dy };
    case "edge-n":
      return { dx: 0, dy, dw: 0, dh: -dy };
    case "edge-s":
      return { dx: 0, dy: 0, dw: 0, dh: dy };
    case "edge-w":
      return { dx, dy: 0, dw: -dx, dh: 0 };
    case "edge-e":
      return { dx: 0, dy: 0, dw: dx, dh: 0 };
    default:
      return { dx: 0, dy: 0, dw: 0, dh: 0 };
  }
}

/** Snapshot the current geometry of every selected rect (across all clusters). */
function captureOrigins(): Record<string, PixelRect> {
  const { rectsByCluster, selectedRectIds } = useCropStore.getState();
  if (selectedRectIds.size === 0) return {};
  const origins: Record<string, PixelRect> = {};
  for (const list of Object.values(rectsByCluster)) {
    for (const r of list) {
      if (selectedRectIds.has(r.id)) origins[r.id] = { x: r.x, y: r.y, w: r.w, h: r.h };
    }
  }
  return origins;
}

/** Build { clusterId -> image dims } from the rendered previews. */
function buildDimsByCluster(): Record<string, { imgW: number; imgH: number }> {
  const dimsByCluster: Record<string, { imgW: number; imgH: number }> = {};
  for (const p of useWorkspaceStore.getState().previews) {
    dimsByCluster[p.clusterId] = { imgW: p.preview.width, imgH: p.preview.height };
  }
  return dimsByCluster;
}

export default function ClusterPanel({ cluster, preview, previewUrl }: Props) {
  const imgW = preview.width;
  const imgH = preview.height;
  const zoom = useWorkspaceStore((s) => s.zoom);
  const rects = useCropStore((s) => s.rectsByCluster[cluster.id] ?? []);
  const selectedRectIds = useCropStore((s) => s.selectedRectIds);
  const syncSizes = useCropStore((s) => s.syncSizes);
  const addRect = useCropStore((s) => s.addRect);
  const updateRect = useCropStore((s) => s.updateRect);
  const removeRect = useCropStore((s) => s.removeRect);
  const toggleSelect = useCropStore((s) => s.toggleSelect);
  const selectOnly = useCropStore((s) => s.selectOnly);
  const clearSelection = useCropStore((s) => s.clearSelection);
  const removeSelectedRects = useCropStore((s) => s.removeSelectedRects);
  const applyDeltaToSelectionExcept = useCropStore((s) => s.applyDeltaToSelectionExcept);
  const applyDeltaToSelection = useCropStore((s) => s.applyDeltaToSelection);
  const setActiveCluster = useCropStore((s) => s.setActiveCluster);
  const copy = useCropStore((s) => s.copy);
  const paste = useCropStore((s) => s.paste);
  const replaceRect = useCropStore((s) => s.replaceRect);
  const propagateSizeFromRect = useCropStore((s) => s.propagateSizeFromRect);
  const alignSelectedRects = useCropStore((s) => s.alignSelectedRects);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragState = useRef<{
    handle: Handle;
    rectId: string | null;
    startX: number;
    startY: number;
    orig: PixelRect | null;
    origins: Record<string, PixelRect>;
  } | null>(null);
  const [hoverHandle, setHoverHandle] = useState<Handle | null>(null);
  const [menu, setMenu] = useState<{ rectId: string; x: number; y: number } | null>(null);

  // Seed an auto-crop rectangle on first mount.
  useEffect(() => {
    if (useCropStore.getState().rectsByCluster[cluster.id]?.length) return;
    try {
      const ratios = getAutoCropRatios(preview);
      const px = ratiosToPixelRect(ratios, imgW, imgH);
      if (px.w > 0 && px.h > 0) {
        addRect(cluster.id, { id: newRectId(), ...px });
      }
    } catch {
      // ignore — leave cluster empty
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster.id]);

  const toImageCoords = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const svg = svgRef.current!;
      const rect = svg.getBoundingClientRect();
      const scaleX = imgW / rect.width;
      const scaleY = imgH / rect.height;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    },
    [imgW, imgH],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      // Only the primary button draws / drags; let right-click reach
      // `onContextMenu` so the split menu can open.
      if (e.button !== 0) return;
      e.preventDefault();
      svgRef.current?.setPointerCapture(e.pointerId);
      // This panel is now the paste target.
      setActiveCluster(cluster.id);
      const { x, y } = toImageCoords(e.clientX, e.clientY);

      // Iterate rects in reverse so newest is hit first.
      let chosen: { rect: CropRect; handle: Handle } | null = null;
      for (let i = rects.length - 1; i >= 0; i--) {
        const r = rects[i]!;
        const isSelected = selectedRectIds.has(r.id);
        const handle = hitTest(r, x, y, isSelected);
        if (handle) {
          chosen = { rect: r, handle };
          break;
        }
      }

      if (chosen) {
        // Shift+click toggles membership in the global selection and does not
        // start a drag (mirrors Briss's changeSelectRectangle).
        if (e.shiftKey) {
          toggleSelect(chosen.rect.id);
          return;
        }
        // Plain click: if the rect isn't already selected, replace the
        // selection with it; otherwise keep the current group so a drag moves
        // the whole set together.
        if (!selectedRectIds.has(chosen.rect.id)) {
          selectOnly(chosen.rect.id);
        }
        dragState.current = {
          handle: chosen.handle,
          rectId: chosen.rect.id,
          startX: x,
          startY: y,
          orig: { ...chosen.rect },
          origins: captureOrigins(),
        };
        return;
      }

      // Empty area: start drawing a new rect.
      clearSelection();
      const id = newRectId();
      const initial: CropRect = { id, x, y, w: 0, h: 0 };
      addRect(cluster.id, initial);
      dragState.current = {
        handle: "draw",
        rectId: id,
        startX: x,
        startY: y,
        orig: { x, y, w: 0, h: 0 },
        origins: {},
      };
    },
    [
      addRect,
      clearSelection,
      cluster.id,
      rects,
      selectOnly,
      selectedRectIds,
      setActiveCluster,
      toImageCoords,
      toggleSelect,
    ],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const { x, y } = toImageCoords(e.clientX, e.clientY);
      const state = dragState.current;
      if (!state) {
        // Hover detection
        let hover: Handle | null = null;
        for (let i = rects.length - 1; i >= 0; i--) {
          const r = rects[i]!;
          const isSelected = selectedRectIds.has(r.id);
          const handle = hitTest(r, x, y, isSelected);
          if (handle) {
            hover = handle;
            break;
          }
        }
        setHoverHandle(hover);
        return;
      }

      const dx = x - state.startX;
      const dy = y - state.startY;
      const o = state.orig!;
      let patch: Partial<CropRect> = {};
      switch (state.handle) {
        case "draw": {
          patch = {
            x: Math.min(state.startX, x),
            y: Math.min(state.startY, y),
            w: Math.abs(dx),
            h: Math.abs(dy),
          };
          break;
        }
        case "move": {
          patch = {
            x: Math.max(0, Math.min(imgW - o.w, o.x + dx)),
            y: Math.max(0, Math.min(imgH - o.h, o.y + dy)),
          };
          break;
        }
        case "nw": {
          const nx = Math.max(0, Math.min(o.x + o.w - 1, o.x + dx));
          const ny = Math.max(0, Math.min(o.y + o.h - 1, o.y + dy));
          patch = { x: nx, y: ny, w: o.x + o.w - nx, h: o.y + o.h - ny };
          break;
        }
        case "ne": {
          const nx2 = Math.max(o.x + 1, Math.min(imgW, o.x + o.w + dx));
          const ny = Math.max(0, Math.min(o.y + o.h - 1, o.y + dy));
          patch = { x: o.x, y: ny, w: nx2 - o.x, h: o.y + o.h - ny };
          break;
        }
        case "sw": {
          const nx = Math.max(0, Math.min(o.x + o.w - 1, o.x + dx));
          const ny2 = Math.max(o.y + 1, Math.min(imgH, o.y + o.h + dy));
          patch = { x: nx, y: o.y, w: o.x + o.w - nx, h: ny2 - o.y };
          break;
        }
        case "se": {
          const nx2 = Math.max(o.x + 1, Math.min(imgW, o.x + o.w + dx));
          const ny2 = Math.max(o.y + 1, Math.min(imgH, o.y + o.h + dy));
          patch = { x: o.x, y: o.y, w: nx2 - o.x, h: ny2 - o.y };
          break;
        }
        case "edge-n": {
          const ny = Math.max(0, Math.min(o.y + o.h - 1, o.y + dy));
          patch = { y: ny, h: o.y + o.h - ny };
          break;
        }
        case "edge-s": {
          const ny2 = Math.max(o.y + 1, Math.min(imgH, o.y + o.h + dy));
          patch = { h: ny2 - o.y };
          break;
        }
        case "edge-w": {
          const nx = Math.max(0, Math.min(o.x + o.w - 1, o.x + dx));
          patch = { x: nx, w: o.x + o.w - nx };
          break;
        }
        case "edge-e": {
          const nx2 = Math.max(o.x + 1, Math.min(imgW, o.x + o.w + dx));
          patch = { w: nx2 - o.x };
          break;
        }
      }
      if (state.rectId) updateRect(cluster.id, state.rectId, patch);

      // Broadcast the same delta to every other selected rect across all
      // clusters. Skip while drawing — a brand-new rect has no peers to mirror.
      if (state.rectId && state.handle !== "draw") {
        const dimsByCluster = buildDimsByCluster();
        const delta = deltaForHandle(state.handle, dx, dy);
        applyDeltaToSelectionExcept(state.rectId, delta, state.origins, dimsByCluster);
        if (syncSizes && state.handle !== "move" && ("w" in patch || "h" in patch)) {
          propagateSizeFromRect(cluster.id, state.rectId, dimsByCluster, anchorForHandle(state.handle));
        }
      }
    },
    [
      applyDeltaToSelectionExcept,
      cluster.id,
      imgH,
      imgW,
      propagateSizeFromRect,
      rects,
      selectedRectIds,
      syncSizes,
      toImageCoords,
      updateRect,
    ],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      svgRef.current?.releasePointerCapture(e.pointerId);
      const state = dragState.current;
      dragState.current = null;
      if (state?.handle === "draw" && state.rectId) {
        const r = useCropStore.getState().rectsByCluster[cluster.id]?.find((x) => x.id === state.rectId);
        if (r && !hasEnoughSpaceForHandles(r)) {
          removeRect(cluster.id, state.rectId);
        }
      }
    },
    [cluster.id, removeRect],
  );

  // Keyboard shortcuts (mirrors Briss's `MergedPanelKeyAdapter`): Delete and
  // the arrow-key move/resize act over the whole global selection, Escape
  // deselects (and closes an open split menu), and Ctrl/Cmd+C / V copy/paste
  // crop-rect layouts in memory. Arrow-key move/resize and copy/paste are
  // gated to the active cluster so they fire exactly once even though every
  // mounted ClusterPanel registers this listener — the actions themselves
  // still operate on the global selection. Typing in a form field is left
  // alone so the shortcuts never hijack text entry.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      const key = e.key.toLowerCase();
      const isCopyPaste = (key === "c" || key === "v") && (e.ctrlKey || e.metaKey);
      const isArrow = e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown";
      if (e.key !== "Delete" && e.key !== "Backspace" && e.key !== "Escape" && !isCopyPaste && !isArrow) return;
      if (e.key === "Escape") {
        if (menu) {
          setMenu(null);
          return;
        }
        clearSelection();
        return;
      }
      // Move/resize and copy/paste fire from the active panel only, so the
      // delta reaches the selection exactly once (the action still applies it
      // to every selected rect, regardless of cluster).
      if ((isArrow || isCopyPaste) && useCropStore.getState().activeClusterId !== cluster.id) return;
      if (isArrow) {
        if (useCropStore.getState().selectedRectIds.size === 0) return;
        e.preventDefault();
        // Base step is 1px; Shift scales it to 10px (Briss multiplies x/y).
        let dx = 0;
        let dy = 0;
        if (e.key === "ArrowLeft") dx = -1;
        else if (e.key === "ArrowRight") dx = 1;
        else if (e.key === "ArrowUp") dy = -1;
        else dy = 1; // ArrowDown
        if (e.shiftKey) {
          dx *= 10;
          dy *= 10;
        }
        // Ctrl/Cmd resizes (top-left corner fixed) instead of moving — mirrors
        // Briss's `resizeSelRects` vs `moveSelectedRects`.
        const delta: RectDelta = e.ctrlKey || e.metaKey ? { dx: 0, dy: 0, dw: dx, dh: dy } : { dx, dy, dw: 0, dh: 0 };
        applyDeltaToSelection(delta, buildDimsByCluster());
        return;
      }
      e.preventDefault();
      if (isCopyPaste) {
        if (key === "c") copy();
        else paste(cluster.id);
        return;
      }
      if (useCropStore.getState().selectedRectIds.size > 0) {
        removeSelectedRects();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyDeltaToSelection, clearSelection, cluster.id, copy, menu, paste, removeSelectedRects]);

  // Right-click on a rect: open the context menu. If the rect under the
  // cursor isn't already part of the selection, replace the selection with it
  // (so single-right-click behaves like a single left-click); otherwise keep
  // the existing group so "Align selected" can snap the whole set to the
  // reference (mirrors Briss's showPopUpMenu, which never changes selection).
  const onContextMenu = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const { x, y } = toImageCoords(e.clientX, e.clientY);
      for (let i = rects.length - 1; i >= 0; i--) {
        const r = rects[i]!;
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          e.preventDefault();
          if (!selectedRectIds.has(r.id)) selectOnly(r.id);
          setMenu({ rectId: r.id, x: e.clientX, y: e.clientY });
          return;
        }
      }
      setMenu(null);
    },
    [rects, selectOnly, selectedRectIds, toImageCoords],
  );

  const splitSelected = useCallback(
    (axis: "column" | "row") => {
      const rectId = menu?.rectId;
      setMenu(null);
      if (!rectId) return;
      const rect = useCropStore.getState().rectsByCluster[cluster.id]?.find((r) => r.id === rectId);
      if (!rect) return;
      const [a, b] = axis === "column" ? splitColumn(preview, rect) : splitRow(preview, rect);
      replaceRect(cluster.id, rectId, [
        { id: newRectId(), ...a },
        { id: newRectId(), ...b },
      ]);
    },
    [cluster.id, menu, preview, replaceRect],
  );

  // Port of Briss's MergedPanel.alignSelected / BrissGUIApp.alignSelRects:
  // the rect under the cursor (the one the menu opened on) is the reference,
  // and every selected rect across all clusters snaps to its x/y/w/h.
  const alignSelected = useCallback(() => {
    const rectId = menu?.rectId;
    setMenu(null);
    if (!rectId) return;
    const rect = useCropStore.getState().rectsByCluster[cluster.id]?.find((r) => r.id === rectId);
    if (!rect) return;
    alignSelectedRects({ x: rect.x, y: rect.y, w: rect.w, h: rect.h }, buildDimsByCluster());
  }, [alignSelectedRects, cluster.id, menu]);

  const cursor = cursorFor(hoverHandle);

  return (
    <div
      className="cluster-panel"
      style={
        {
          // Auto-fit each panel to FIT_PADDING of the viewport height, then
          // multiply by the manual zoom factor.
          "--fit-width": `calc(${FIT_PADDING} * (100vh - 120px) * ${imgW} / ${imgH} * ${zoom})`,
          "--zoom": String(zoom),
        } as CSSProperties
      }
    >
      <svg
        ref={svgRef}
        className="cluster-panel__svg"
        viewBox={`0 0 ${imgW} ${imgH}`}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onContextMenu={onContextMenu}
      >
        <image href={previewUrl} x={0} y={0} width={imgW} height={imgH} />
        {rects.map((r, idx) => {
          const selected = selectedRectIds.has(r.id);
          const tooSmall = !hasEnoughSpaceForHandles(r);
          const fill = tooSmall ? "rgba(220, 50, 50, 0.25)" : "rgba(60, 130, 220, 0.25)";
          const stroke = selected ? "#000" : "rgba(60,130,220,0.9)";
          return (
            <g key={r.id}>
              <rect
                className="cluster-panel__crop-rect"
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                fill={fill}
                stroke={stroke}
                strokeWidth={selected ? 2 : 1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={r.x + 2}
                y={r.y + 12}
                fill="#000"
                fontSize={Math.min(12, Math.max(8, r.h / 8))}
                fontFamily="sans-serif"
              >
                {idx + 1}
              </text>
              {/* Size label on selected rects. Port of DrawableCropRect.drawSelectionOverlay. */}
              {selected && (
                <text
                  x={r.x + 4}
                  y={r.y + r.h - 4}
                  fill="#ffd400"
                  stroke="#000"
                  strokeWidth={0.5}
                  paintOrder="stroke"
                  fontSize={Math.min(12, Math.max(8, r.h / 10))}
                  fontFamily="sans-serif"
                >
                  {formatCropSizeLabel(r)}
                </text>
              )}
              {selected &&
                (
                  [
                    [r.x, r.y],
                    [r.x + r.w, r.y],
                    [r.x, r.y + r.h],
                    [r.x + r.w, r.y + r.h],
                  ] as Array<[number, number]>
                ).map(([hx, hy], i) => (
                  <rect
                    key={i}
                    x={hx - CORNER_DIMENSION / 2}
                    y={hy - CORNER_DIMENSION / 2}
                    width={CORNER_DIMENSION}
                    height={CORNER_DIMENSION}
                    fill="#fff"
                    stroke="#000"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
            </g>
          );
        })}
      </svg>
      <div className="cluster-panel__meta">
        {cluster.excluded ? (
          <strong className="cluster-panel__excluded">Excluded</strong>
        ) : (
          <strong>{cluster.parity === "odd" ? "Odd" : "Even"}</strong>
        )}
        {" · "}
        {cluster.allPages.length} page{cluster.allPages.length === 1 ? "" : "s"}
        {" · "}
        {cluster.width.toFixed(0)} × {cluster.height.toFixed(0)}
      </div>
      {menu && (
        <>
          <div
            className="cluster-panel__menu-backdrop"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div className="cluster-panel__menu" role="menu" style={{ left: menu.x, top: menu.y }}>
            <button type="button" role="menuitem" onClick={() => splitSelected("column")}>
              Split column
            </button>
            <button type="button" role="menuitem" onClick={() => splitSelected("row")}>
              Split row
            </button>
            <button type="button" role="menuitem" onClick={alignSelected}>
              Align selected
            </button>
          </div>
        </>
      )}
    </div>
  );
}
