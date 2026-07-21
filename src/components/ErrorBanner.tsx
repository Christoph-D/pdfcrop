import { useWorkspaceStore } from "@/store/workspaceStore";

/**
 * Lightweight top-level error surface. For MVP we render the error message
 * prominently and offer a reset button. (React error boundaries with hooks
 * are intentionally kept simple here.)
 */
export default function ErrorBanner() {
  const error = useWorkspaceStore((s) => s.error);
  const status = useWorkspaceStore((s) => s.status);
  const reset = useWorkspaceStore((s) => s.reset);

  if (!error || status !== "error") return null;
  return (
    <div className="error-banner error-banner--blocking">
      <div className="error-banner__title">Something went wrong</div>
      <pre className="error-banner__message">{error}</pre>
      <button
        type="button"
        className="error-banner__reset"
        onClick={reset}
      >
        Start over
      </button>
    </div>
  );
}
