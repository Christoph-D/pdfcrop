import { useCallback, useEffect, useState, type ReactNode } from "react";
import { loadPdf, PasswordRequiredError, InvalidPasswordError } from "@/lib/pdf/read";
import { useWorkspaceStore } from "@/store/workspaceStore";
import PasswordModal from "@/components/PasswordModal";

export interface UsePdfLoaderResult {
  isLoading: boolean;
  handleFile: (file: File | undefined | null) => void;
  passwordModal: ReactNode;
}

export function usePdfLoader(): UsePdfLoaderResult {
  const setSource = useWorkspaceStore((s) => s.setSource);
  const setError = useWorkspaceStore((s) => s.setError);
  const [isLoading, setIsLoading] = useState(false);
  const [passwordFor, setPasswordFor] = useState<File | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const tryLoad = useCallback(
    async (file: File, password?: string) => {
      setIsLoading(true);
      try {
        const buf = await file.arrayBuffer();
        const src = await loadPdf(buf, file.name, password);
        setSource(src, password ?? null);
      } catch (err) {
        if (err instanceof PasswordRequiredError) {
          setPasswordFor(file);
          setPasswordInput("");
          setPasswordError(null);
        } else if (err instanceof InvalidPasswordError) {
          setPasswordFor(file);
          setPasswordError("Incorrect password, please try again.");
          setPasswordInput("");
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setIsLoading(false);
      }
    },
    [setSource, setError],
  );

  const handleFile = useCallback(
    (file: File | undefined | null) => {
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        setError("Please choose a .pdf file.");
        return;
      }
      void tryLoad(file);
    },
    [tryLoad, setError],
  );

  const submitPassword = useCallback(async () => {
    if (!passwordFor) return;
    const before = useWorkspaceStore.getState().source;
    await tryLoad(passwordFor, passwordInput);
    const after = useWorkspaceStore.getState().source;
    if (after && after !== before) {
      setPasswordFor(null);
      setPasswordInput("");
      setPasswordError(null);
    }
  }, [passwordFor, passwordInput, tryLoad]);

  const cancelPassword = useCallback(() => {
    setPasswordFor(null);
    setPasswordInput("");
    setPasswordError(null);
  }, []);

  useEffect(() => {
    if (!passwordFor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPasswordFor(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [passwordFor]);

  const passwordModal = passwordFor ? (
    <PasswordModal
      fileName={passwordFor.name}
      passwordInput={passwordInput}
      passwordError={passwordError}
      onPasswordChange={setPasswordInput}
      onSubmit={() => void submitPassword()}
      onCancel={cancelPassword}
    />
  ) : null;

  return { isLoading, handleFile, passwordModal };
}
