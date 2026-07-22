import { useCallback, useState } from "react";
import { loadPdf } from "@/lib/pdf/read";
import { useWorkspaceStore } from "@/store/workspaceStore";

export interface UsePdfLoaderResult {
  isLoading: boolean;
  handleFile: (file: File | undefined | null) => void;
}

export function usePdfLoader(): UsePdfLoaderResult {
  const setSource = useWorkspaceStore((s) => s.setSource);
  const setError = useWorkspaceStore((s) => s.setError);
  const [isLoading, setIsLoading] = useState(false);

  const handleFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        setError("Please choose a .pdf file.");
        return;
      }
      setIsLoading(true);
      try {
        const buf = await file.arrayBuffer();
        const src = await loadPdf(buf, file.name);
        setSource(src);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    },
    [setSource, setError],
  );

  return { isLoading, handleFile };
}
