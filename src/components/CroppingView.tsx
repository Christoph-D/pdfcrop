import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspaceStore, ZOOM_STEP } from "@/store/workspaceStore";
import { useCropStore } from "@/store/cropStore";
import { usePdfLoader } from "@/hooks/usePdfLoader";
import { useLoadShortcut } from "@/hooks/useLoadShortcut";
import { parsePageExcludes } from "@/lib/pdf/cluster";
import ClusterPanel from "@/components/ClusterPanel";
import "./CroppingView.css";

export default function CroppingView() {
  const source = useWorkspaceStore((s) => s.source)!;
  const clusters = useWorkspaceStore((s) => s.clusters);
  const previews = useWorkspaceStore((s) => s.previews);
  const status = useWorkspaceStore((s) => s.status);
  const isReclustering = useWorkspaceStore((s) => s.isReclustering);
  const error = useWorkspaceStore((s) => s.error);
  const lastCrop = useWorkspaceStore((s) => s.lastCrop);
  const cropPreview = useWorkspaceStore((s) => s.cropPreview);
  const cropDownload = useWorkspaceStore((s) => s.cropDownload);
  const zoom = useWorkspaceStore((s) => s.zoom);
  const zoomIn = useWorkspaceStore((s) => s.zoomIn);
  const zoomOut = useWorkspaceStore((s) => s.zoomOut);
  const fitToWindow = useWorkspaceStore((s) => s.fitToWindow);
  const exportCropSettings = useWorkspaceStore((s) => s.exportCropSettings);
  const importCropSettings = useWorkspaceStore((s) => s.importCropSettings);
  const lastImport = useWorkspaceStore((s) => s.lastImport);
  const dismissImportNotice = useWorkspaceStore((s) => s.dismissImportNotice);
  const recluster = useWorkspaceStore((s) => s.reclusterWithExcludes);
  const syncSizes = useCropStore((s) => s.syncSizes);
  const setSyncSizes = useCropStore((s) => s.setSyncSizes);
  const propagateSizeFromRect = useCropStore((s) => s.propagateSizeFromRect);
  const { handleFile } = usePdfLoader();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // "L" accelerator opens the load-file picker (Briss menu shortcut).
  useLoadShortcut(fileInputRef);
  const settingsInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [outlineDismissed, setOutlineDismissed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const dragDepth = useRef(0);
  const [excludeModalOpen, setExcludeModalOpen] = useState(false);
  const [excludeInput, setExcludeInput] = useState("");
  const [excludeError, setExcludeError] = useState<string | null>(null);

  // Ctrl/Cmd + wheel zooms; a plain wheel scrolls the container as usual.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = Math.pow(ZOOM_STEP, -e.deltaY / 100);
      useWorkspaceStore.getState().zoomBy(factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onGridPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only start panning from the grid background — panels handle their own
    // pointer events (drawing / moving crop rectangles).
    if (e.target !== gridRef.current) return;
    if (e.button !== 0) return;
    const el = scrollRef.current!;
    panRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    gridRef.current.setPointerCapture(e.pointerId);
    setIsPanning(true);
  };

  const onGridPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    const el = scrollRef.current!;
    el.scrollLeft = pan.scrollLeft - (e.clientX - pan.startX);
    el.scrollTop = pan.scrollTop - (e.clientY - pan.startY);
  };

  const endGridPan = (e: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    gridRef.current?.releasePointerCapture(e.pointerId);
    panRef.current = null;
    setIsPanning(false);
  };

  const showOutlineWarning = lastCrop && !lastCrop.outlinePreserved && !outlineDismissed;

  const dimsByCluster = useMemo(() => {
    const map: Record<string, { imgW: number; imgH: number }> = {};
    for (const p of previews) {
      map[p.clusterId] = { imgW: p.preview.width, imgH: p.preview.height };
    }
    return map;
  }, [previews]);

  // Disable mutating actions while previews are stale (re-clustering) or a
  // crop/export is in flight.
  const busy = status === "cropping" || isReclustering;

  const toggleSync = (v: boolean) => {
    setSyncSizes(v);
    if (!v) return;
    const state = useCropStore.getState();
    // Sync from the first selected rect (any cluster); fall back to the first
    // rect overall if nothing is selected.
    let sourceClusterId: string | null = null;
    let sourceRectId: string | null = null;
    for (const [cid, list] of Object.entries(state.rectsByCluster)) {
      const hit = list.find((r) => state.selectedRectIds.has(r.id));
      if (hit) {
        sourceClusterId = cid;
        sourceRectId = hit.id;
        break;
      }
    }
    const hasValidSelection = sourceClusterId && sourceRectId;
    if (!hasValidSelection) {
      for (const [cid, list] of Object.entries(state.rectsByCluster)) {
        if (list.length) {
          sourceClusterId = cid;
          sourceRectId = list[0]!.id;
          break;
        }
      }
    }
    if (sourceClusterId && sourceRectId) {
      propagateSizeFromRect(sourceClusterId, sourceRectId, dimsByCluster, {
        fixedLeft: true,
        fixedTop: true,
      });
    }
  };

  const openExcludeModal = () => {
    const current = useWorkspaceStore.getState().excludes;
    setExcludeInput(current.size ? formatExcludes(current) : "");
    setExcludeError(null);
    setExcludeModalOpen(true);
  };

  const submitExcludes = () => {
    try {
      const excludes = parsePageExcludes(excludeInput);
      recluster(excludes);
      setExcludeModalOpen(false);
    } catch (err) {
      setExcludeError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      className="cropping-view"
      ref={scrollRef}
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current += 1;
        setIsDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setIsDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setIsDragging(false);
        handleFile(e.dataTransfer.files[0]);
      }}
    >
      <input
        type="file"
        accept="application/pdf,.pdf"
        hidden
        ref={fileInputRef}
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        type="file"
        accept="application/json,.json"
        hidden
        ref={settingsInputRef}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importCropSettings(f);
          e.target.value = "";
        }}
      />
      {isDragging && (
        <div className="cropping-view__drop-overlay" aria-hidden="true">
          <span className="cropping-view__drop-message">Drop PDF to load</span>
        </div>
      )}
      {status === "cropping" && (
        <div className="cropping-view__overlay" role="status" aria-live="polite">
          <div className="cropping-view__modal">
            <div className="cropping-view__spinner" aria-hidden="true" />
            <span className="cropping-view__modal-label">Cropping…</span>
          </div>
        </div>
      )}
      {excludeModalOpen && (
        <div
          className="cropping-view__overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Exclude pages"
          onClick={(e) => {
            if (e.target === e.currentTarget) setExcludeModalOpen(false);
          }}
        >
          <div className="cropping-view__prompt">
            <label className="cropping-view__prompt-label" htmlFor="exclude-input">
              Exclude pages
            </label>
            <p className="cropping-view__prompt-hint">
              Pages listed here are forced into their own singleton clusters so they don’t pollute the merged preview.
              Syntax: <code>1-4;6;9</code>
            </p>
            <input
              id="exclude-input"
              className="cropping-view__prompt-input"
              type="text"
              autoFocus
              value={excludeInput}
              placeholder="e.g. 1-4;6;9"
              onChange={(e) => {
                setExcludeInput(e.target.value);
                setExcludeError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitExcludes();
                } else if (e.key === "Escape") {
                  setExcludeModalOpen(false);
                }
              }}
            />
            {excludeError && <div className="cropping-view__prompt-error">{excludeError}</div>}
            <div className="cropping-view__prompt-actions">
              <button type="button" className="cropping-view__secondary" onClick={() => setExcludeModalOpen(false)}>
                Cancel
              </button>
              <button type="button" className="cropping-view__primary" onClick={submitExcludes}>
                Re-cluster
              </button>
            </div>
          </div>
        </div>
      )}
      <header className="cropping-view__header">
        <h1 className="cropping-view__title">{source.fileName}</h1>
        <span className="cropping-view__count">
          {clusters.length} clusters · {source.pages.length} pages
        </span>
        <label className="cropping-view__sync">
          <input type="checkbox" checked={syncSizes} onChange={(e) => toggleSync(e.target.checked)} />
          Synchronize sizes
        </label>
        <div className="cropping-view__spacer" />
        <div className="cropping-view__zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            className="cropping-view__zoom-btn"
            onClick={zoomOut}
            aria-label="Zoom out"
            title="Zoom out"
          >
            −
          </button>
          <button type="button" className="cropping-view__zoom-readout" onClick={fitToWindow} title="Reset zoom to fit">
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="cropping-view__zoom-btn"
            onClick={zoomIn}
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
          <button type="button" className="cropping-view__zoom-fit" onClick={fitToWindow} title="Fit to window">
            Fit
          </button>
        </div>
        <button
          type="button"
          className="cropping-view__secondary"
          disabled={status === "cropping"}
          onClick={() => settingsInputRef.current?.click()}
        >
          Import settings
        </button>
        <button
          type="button"
          className="cropping-view__secondary"
          disabled={status === "cropping"}
          onClick={() => void exportCropSettings()}
        >
          Export settings
        </button>
        <button
          type="button"
          className="cropping-view__secondary"
          disabled={busy}
          onClick={openExcludeModal}
          title="Re-cluster, forcing selected pages into their own singleton clusters"
        >
          Re-cluster with excludes
        </button>
        <button
          type="button"
          className="cropping-view__secondary"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          Load new PDF
        </button>
        <span className="cropping-view__crop-label">Crop:</span>
        <button type="button" className="cropping-view__primary" disabled={busy} onClick={() => void cropPreview()}>
          Preview
        </button>
        <button type="button" className="cropping-view__primary" disabled={busy} onClick={() => void cropDownload()}>
          Download
        </button>
      </header>

      {showOutlineWarning && (
        <div className="cropping-view__warn">
          Bookmarks were removed because at least one cluster has multiple crop rectangles.{" "}
          <button type="button" onClick={() => setOutlineDismissed(true)}>
            dismiss
          </button>
        </div>
      )}
      {lastImport && (
        <div className="cropping-view__notice">
          Applied crop settings: {lastImport.matched} cluster{lastImport.matched === 1 ? "" : "s"} matched
          {lastImport.skipped > 0 ? `, ${lastImport.skipped} skipped` : ""}.{" "}
          <button type="button" onClick={() => dismissImportNotice()}>
            dismiss
          </button>
        </div>
      )}
      {error && <div className="cropping-view__error">Error: {error}</div>}

      <div
        className={`cropping-view__grid${isPanning ? " cropping-view__grid--panning" : ""}`}
        ref={gridRef}
        onPointerDown={onGridPointerDown}
        onPointerMove={onGridPointerMove}
        onPointerUp={endGridPan}
        onPointerCancel={endGridPan}
      >
        {clusters.map((cluster) => {
          const preview = previews.find((p) => p.clusterId === cluster.id);
          if (!preview) {
            return (
              <div key={cluster.id} className="cluster-card">
                <div className="cluster-card__placeholder">…</div>
              </div>
            );
          }
          return (
            <ClusterPanel
              key={cluster.id}
              cluster={cluster}
              preview={preview.preview}
              previewUrl={preview.previewUrl}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Render the current exclude set back into Briss syntax (`1-4;6;9`) by
 * collapsing consecutive page numbers into ranges.
 */
function formatExcludes(excludes: ReadonlySet<number>): string {
  const sorted = [...excludes].sort((a, b) => a - b);
  const tokens: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1]! === sorted[j]! + 1) j++;
    tokens.push(j > i ? `${sorted[i]!}-${sorted[j]!}` : `${sorted[i]!}`);
    i = j + 1;
  }
  return tokens.join(";");
}
