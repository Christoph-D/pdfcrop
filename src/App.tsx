import { useEffect } from "react";
import { renderClusterPreviews } from "@/lib/pdf/render";
import { useWorkspaceStore } from "@/store/workspaceStore";
import StartScreen from "@/components/StartScreen";
import CroppingView from "@/components/CroppingView";
import ProgressBar from "@/components/ProgressBar";
import ErrorBanner from "@/components/ErrorBanner";

export default function App() {
  const source = useWorkspaceStore((s) => s.source);
  const clusters = useWorkspaceStore((s) => s.clusters);
  const isReclustering = useWorkspaceStore((s) => s.isReclustering);
  const status = useWorkspaceStore((s) => s.status);
  const setStatus = useWorkspaceStore((s) => s.setStatus);
  const setPreviews = useWorkspaceStore((s) => s.setPreviews);
  const setProgress = useWorkspaceStore((s) => s.setProgress);
  const setError = useWorkspaceStore((s) => s.setError);

  // Render (or re-render) merged previews whenever the cluster set changes.
  // Clustering itself happens in the store actions (`setSource`,
  // `reclusterWithExcludes`) so it — and the crop-rect transfer on re-cluster
  // — runs exactly once rather than under StrictMode's dev double-invoke.
  useEffect(() => {
    if (!source || clusters.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        setStatus("rendering");
        setProgress(
          0,
          clusters.reduce((n, c) => n + c.pagesToMerge.length, 0),
        );
        const previews = await renderClusterPreviews(source.data, clusters, (done, total) => {
          if (!cancelled) setProgress(done, total);
        });
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
  }, [source, clusters, setStatus, setPreviews, setProgress, setError]);

  // The cropping view stays mounted across a re-cluster (isReclustering) so
  // users keep their context while previews re-render.
  if (source && (status === "ready" || status === "cropping" || status === "error" || isReclustering)) {
    return <CroppingView />;
  }

  const isBusy = status === "clustering" || status === "rendering";

  return (
    <>
      <ErrorBanner />
      {isBusy && <ProgressBar />}
      {status !== "error" && <StartScreen />}
    </>
  );
}
