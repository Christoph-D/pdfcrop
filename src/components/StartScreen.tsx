import { useRef, useState } from "react";
import { usePdfLoader } from "@/hooks/usePdfLoader";
import "./StartScreen.css";

export default function StartScreen() {
  const { isLoading, handleFile, passwordModal } = usePdfLoader();
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);

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
            <input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
          </label>
        </p>
        {isLoading && <p className="drop-zone__loading">Loading…</p>}
      </div>

      {passwordModal}
    </div>
  );
}
