import { useWorkspaceStore } from "@/store/workspaceStore";
import "./CroppingView.css";

export default function CroppingView() {
  const source = useWorkspaceStore((s) => s.source)!;
  const clusters = useWorkspaceStore((s) => s.clusters);
  const previews = useWorkspaceStore((s) => s.previews);

  return (
    <div className="cropping-view">
      <header className="cropping-view__header">
        <h1 className="cropping-view__title">{source.fileName}</h1>
        <span className="cropping-view__count">
          {clusters.length} clusters · {source.pages.length} pages
        </span>
      </header>
      <div className="cropping-view__grid">
        {clusters.map((cluster) => {
          const preview = previews.find((p) => p.clusterId === cluster.id);
          return (
            <div key={cluster.id} className="cluster-card">
              <div className="cluster-card__image">
                {preview && preview.previewUrl ? (
                  <img
                    src={preview.previewUrl}
                    alt={`${cluster.parity} pages preview`}
                  />
                ) : (
                  <div className="cluster-card__placeholder">…</div>
                )}
              </div>
              <div className="cluster-card__meta">
                <strong>{cluster.parity === "odd" ? "Odd" : "Even"}</strong>
                {" · "}
                {cluster.allPages.length} pages
                {" · "}
                {cluster.width.toFixed(0)} × {cluster.height.toFixed(0)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
