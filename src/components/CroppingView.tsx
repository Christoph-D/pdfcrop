import { useMemo, useState } from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { useCropStore } from "@/store/cropStore";
import ClusterPanel from "@/components/ClusterPanel";
import "./CroppingView.css";

export default function CroppingView() {
  const source = useWorkspaceStore((s) => s.source)!;
  const clusters = useWorkspaceStore((s) => s.clusters);
  const previews = useWorkspaceStore((s) => s.previews);
  const status = useWorkspaceStore((s) => s.status);
  const error = useWorkspaceStore((s) => s.error);
  const lastCrop = useWorkspaceStore((s) => s.lastCrop);
  const cropAndSave = useWorkspaceStore((s) => s.cropAndSave);
  const syncSizes = useCropStore((s) => s.syncSizes);
  const setSyncSizes = useCropStore((s) => s.setSyncSizes);
  const propagateSizeFromRect = useCropStore((s) => s.propagateSizeFromRect);
  const [outlineDismissed, setOutlineDismissed] = useState(false);

  const showOutlineWarning =
    lastCrop && !lastCrop.outlinePreserved && !outlineDismissed;

  const dimsByCluster = useMemo(() => {
    const map: Record<string, { imgW: number; imgH: number }> = {};
    for (const p of previews) {
      map[p.clusterId] = { imgW: p.preview.width, imgH: p.preview.height };
    }
    return map;
  }, [previews]);

  const toggleSync = (v: boolean) => {
    setSyncSizes(v);
    if (!v) return;
    const state = useCropStore.getState();
    let sourceClusterId: string | null = state.selectedClusterId;
    let sourceRectId: string | null = state.selectedRectId;
    const hasValidSelection =
      sourceClusterId &&
      sourceRectId &&
      state.rectsByCluster[sourceClusterId]?.some((r) => r.id === sourceRectId);
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
      propagateSizeFromRect(sourceClusterId, sourceRectId, dimsByCluster);
    }
  };

  return (
    <div className="cropping-view">
      {status === "cropping" && (
        <div className="cropping-view__overlay" role="status" aria-live="polite">
          <div className="cropping-view__modal">
            <div className="cropping-view__spinner" aria-hidden="true" />
            <span className="cropping-view__modal-label">Cropping…</span>
          </div>
        </div>
      )}
      <header className="cropping-view__header">
        <h1 className="cropping-view__title">{source.fileName}</h1>
        <span className="cropping-view__count">
          {clusters.length} clusters · {source.pages.length} pages
        </span>
        <label className="cropping-view__sync">
          <input
            type="checkbox"
            checked={syncSizes}
            onChange={(e) => toggleSync(e.target.checked)}
          />
          Synchronize sizes
        </label>
        <div className="cropping-view__spacer" />
        <button
          type="button"
          className="cropping-view__primary"
          disabled={status === "cropping"}
          onClick={() => void cropAndSave()}
        >
          {status === "cropping" ? "Cropping…" : "Crop PDF"}
        </button>
      </header>

      {showOutlineWarning && (
        <div className="cropping-view__warn">
          Bookmarks were removed because at least one cluster has multiple
          crop rectangles.{" "}
          <button type="button" onClick={() => setOutlineDismissed(true)}>
            dismiss
          </button>
        </div>
      )}
      {error && <div className="cropping-view__error">Error: {error}</div>}

      <div className="cropping-view__grid">
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
