import { useCallback, useEffect, useRef, useState } from "react";
import { loadPdf, PasswordRequiredError, InvalidPasswordError } from "@/lib/pdf/read";
import { useLoadStore } from "@/store/loadStore";
import "./StartScreen.css";

export default function StartScreen() {
  const setSource = useLoadStore((s) => s.setSource);
  const setError = useLoadStore((s) => s.setError);
  const [isDragging, setIsDragging] = useState(false);
  const [passwordFor, setPasswordFor] = useState<File | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const dragDepth = useRef(0);

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
    await tryLoad(passwordFor, passwordInput);
    if (useLoadStore.getState().source === null) {
      // Still not loaded — keep modal open; error already set by tryLoad.
      // The InvalidPasswordError branch will have updated passwordError.
    } else {
      setPasswordFor(null);
      setPasswordInput("");
      setPasswordError(null);
    }
  }, [passwordFor, passwordInput, tryLoad]);

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

  return (
    <div
      className={`drop-zone ${isDragging ? "drop-zone--active" : ""}`}
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
      <div className="drop-zone__content">
        <h1 className="drop-zone__title">PDFCrop</h1>
        <p className="drop-zone__hint">
          Drop a PDF here, or
          <label className="drop-zone__button">
            Choose file
            <input
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </label>
        </p>
        {isLoading && <p className="drop-zone__loading">Loading…</p>}
      </div>

      {passwordFor && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Password required</h2>
            <p>
              <code>{passwordFor.name}</code> is password protected.
            </p>
            {passwordError && <p className="modal__error">{passwordError}</p>}
            <input
              type="password"
              autoFocus
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitPassword();
              }}
              placeholder="Password"
              className="modal__input"
            />
            <div className="modal__actions">
              <button
                type="button"
                className="modal__cancel"
                onClick={() => {
                  setPasswordFor(null);
                  setPasswordInput("");
                  setPasswordError(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal__ok"
                onClick={() => void submitPassword()}
                disabled={!passwordInput}
              >
                Unlock
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
