import { useEffect } from "react";
import { clusterPages } from "@/lib/pdf/cluster";
import { renderClusterPreviews } from "@/lib/pdf/render";
import { useWorkspaceStore } from "@/store/workspaceStore";
import StartScreen from "@/components/StartScreen";
import CroppingView from "@/components/CroppingView";
import ProgressBar from "@/components/ProgressBar";

export default function App() {
  const source = useWorkspaceStore((s) => s.source);
  const password = useWorkspaceStore((s) => s.password);
  const status = useWorkspaceStore((s) => s.status);
  const error = useWorkspaceStore((s) => s.error);
  const setSource = useWorkspaceStore((s) => s.setSource);
  const setClusters = useWorkspaceStore((s) => s.setClusters);
  const setStatus = useWorkspaceStore((s) => s.setStatus);
  const setPreviews = useWorkspaceStore((s) => s.setPreviews);
  const setProgress = useWorkspaceStore((s) => s.setProgress);
  const setError = useWorkspaceStore((s) => s.setError);

  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    (async () => {
      try {
        const clusters = clusterPages(source.pages);
        if (cancelled) return;
        setClusters(clusters);
        setStatus("rendering");
        setProgress(0, clusters.reduce((n, c) => n + c.pagesToMerge.length, 0));
        const previews = await renderClusterPreviews(
          source.data,
          clusters,
          password,
          (done, total) => {
            if (!cancelled) setProgress(done, total);
          },
        );
        if (cancelled) return;
        setPreviews(previews);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    source,
    password,
    setClusters,
    setStatus,
    setPreviews,
    setProgress,
    setError,
    setSource,
  ]);

  if (status === "ready" && source) {
    return <CroppingView />;
  }

  return (
    <>
      {(status === "clustering" || status === "rendering") && (
        <ProgressBar />
      )}
      {error && (
        <div className="error-banner">{error}</div>
      )}
      {status === "error" && <StartScreen />}
      {status === "idle" && <StartScreen />}
    </>
  );
}
