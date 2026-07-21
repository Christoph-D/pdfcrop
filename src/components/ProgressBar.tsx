import { useWorkspaceStore } from "@/store/workspaceStore";
import "./ProgressBar.css";

export default function ProgressBar() {
  const done = useWorkspaceStore((s) => s.progressDone);
  const total = useWorkspaceStore((s) => s.progressTotal);
  const status = useWorkspaceStore((s) => s.status);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const label =
    status === "clustering"
      ? "Clustering pages…"
      : `Rendering previews… ${done}/${total}`;

  return (
    <div className="progress-bar">
      <div className="progress-bar__track">
        <div className="progress-bar__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="progress-bar__label">{label}</span>
    </div>
  );
}
