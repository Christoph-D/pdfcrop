import { useState } from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";
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
  const [outlineDismissed, setOutlineDismissed] = useState(false);

  const showOutlineWarning =
    lastCrop && !lastCrop.outlinePreserved && !outlineDismissed;

  return (
    <div className="cropping-view">
      <header className="cropping-view__header">
        <h1 className="cropping-view__title">{source.fileName}</h1>
        <span className="cropping-view__count">
          {clusters.length} clusters · {source.pages.length} pages
        </span>
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
