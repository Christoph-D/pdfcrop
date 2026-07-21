import { useCallback, useEffect, useRef, useState } from "react";
import type { Cluster } from "@/lib/pdf/cluster";
import type { GrayImage } from "@/lib/pdf/overlay";
import { getAutoCropRatios } from "@/lib/pdf/autocrop";
import {
  CORNER_DIMENSION,
  EDGE_THRESHOLD,
  SELECTABLE_CORNER_DIMENSION,
  hasEnoughSpaceForHandles,
  type PixelRect,
  ratiosToPixelRect,
} from "@/lib/pdf/ratios";
import {
  newRectId,
  useCropStore,
  type CropRect,
} from "@/store/cropStore";
import "./ClusterPanel.css";

type Handle =
  | "move"
  | "nw"
  | "ne"
  | "sw"
  | "se"
  | "edge-n"
  | "edge-s"
  | "edge-e"
  | "edge-w"
  | "draw";

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

export default function ClusterPanel({ cluster, preview, previewUrl }: Props) {
  const imgW = preview.width;
  const imgH = preview.height;
  const rects = useCropStore((s) => s.rectsByCluster[cluster.id] ?? []);
  const selectedRectId = useCropStore((s) => s.selectedRectId);
  const selectedClusterId = useCropStore((s) => s.selectedClusterId);
  const addRect = useCropStore((s) => s.addRect);
  const updateRect = useCropStore((s) => s.updateRect);
  const removeRect = useCropStore((s) => s.removeRect);
  const select = useCropStore((s) => s.select);

  const svgRef = useRef<SVGSVGElement>(null);
  const dragState = useRef<{
    handle: Handle;
    rectId: string | null;
    startX: number;
    startY: number;
    orig: PixelRect | null;
  } | null>(null);
  const [hoverHandle, setHoverHandle] = useState<Handle | null>(null);

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
      e.preventDefault();
      svgRef.current?.setPointerCapture(e.pointerId);
      const { x, y } = toImageCoords(e.clientX, e.clientY);

      // Iterate rects in reverse so newest is hit first.
      let chosen: { rect: CropRect; handle: Handle } | null = null;
      for (let i = rects.length - 1; i >= 0; i--) {
        const r = rects[i]!;
        const isSelected =
          selectedClusterId === cluster.id && selectedRectId === r.id;
        const handle = hitTest(r, x, y, isSelected);
        if (handle) {
          chosen = { rect: r, handle };
          break;
        }
      }

      if (chosen) {
        if (chosen.handle === "move") {
          select(cluster.id, chosen.rect.id);
        }
        dragState.current = {
          handle: chosen.handle,
          rectId: chosen.rect.id,
          startX: x,
          startY: y,
          orig: { ...chosen.rect },
        };
        return;
      }

      // Empty area: start drawing a new rect.
      select(cluster.id, null);
      const id = newRectId();
      const initial: CropRect = { id, x, y, w: 0, h: 0 };
      addRect(cluster.id, initial);
      dragState.current = {
        handle: "draw",
        rectId: id,
        startX: x,
        startY: y,
        orig: { x, y, w: 0, h: 0 },
      };
    },
    [addRect, cluster.id, rects, select, selectedClusterId, selectedRectId, toImageCoords],
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
          const isSelected =
            selectedClusterId === cluster.id && selectedRectId === r.id;
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
    },
    [cluster.id, imgH, imgW, rects, selectedClusterId, selectedRectId, toImageCoords, updateRect],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      svgRef.current?.releasePointerCapture(e.pointerId);
      const state = dragState.current;
      dragState.current = null;
      if (state?.handle === "draw" && state.rectId) {
        const r = useCropStore
          .getState()
          .rectsByCluster[cluster.id]?.find((x) => x.id === state.rectId);
        if (r && !hasEnoughSpaceForHandles(r)) {
          removeRect(cluster.id, state.rectId);
        }
      }
    },
    [cluster.id, removeRect],
  );

  // Delete selected rect on Delete key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key !== "Delete" &&
        e.key !== "Backspace" &&
        e.key !== "Escape"
      )
        return;
      const sel = useCropStore.getState();
      if (e.key === "Escape") {
        select(null, null);
        return;
      }
      if (
        sel.selectedClusterId === cluster.id &&
        sel.selectedRectId
      ) {
        e.preventDefault();
        removeRect(cluster.id, sel.selectedRectId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cluster.id, removeRect, select]);

  const cursor = cursorFor(hoverHandle);

  return (
    <div className="cluster-panel">
      <svg
        ref={svgRef}
        className="cluster-panel__svg"
        viewBox={`0 0 ${imgW} ${imgH}`}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <image href={previewUrl} x={0} y={0} width={imgW} height={imgH} />
        {rects.map((r, idx) => {
          const selected =
            selectedClusterId === cluster.id && selectedRectId === r.id;
          const tooSmall = !hasEnoughSpaceForHandles(r);
          const fill = tooSmall
            ? "rgba(220, 50, 50, 0.25)"
            : "rgba(60, 130, 220, 0.25)";
          const stroke = selected ? "#000" : "rgba(60,130,220,0.9)";
          return (
            <g key={r.id}>
              <rect
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
              {selected &&
                ([[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]] as Array<[number, number]>).map(
                  ([hx, hy], i) => (
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
                  ),
                )}
            </g>
          );
        })}
      </svg>
      <div className="cluster-panel__meta">
        <strong>{cluster.parity === "odd" ? "Odd" : "Even"}</strong>
        {" · "}
        {cluster.allPages.length} pages
        {" · "}
        {cluster.width.toFixed(0)} × {cluster.height.toFixed(0)}
      </div>
    </div>
  );
}
