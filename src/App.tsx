import { useLoadStore } from "@/store/loadStore";
import StartScreen from "@/components/StartScreen";

export default function App() {
  const source = useLoadStore((s) => s.source);
  const error = useLoadStore((s) => s.error);

  if (source) {
    return (
      <div style={{ padding: 24 }}>
        <h1>PDFCrop — {source.fileName}</h1>
        <p>Loaded {source.pages.length} pages.</p>
        <p style={{ color: "#888" }}>
          (Cluster UI coming in later phases.)
        </p>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div
          style={{
            position: "fixed",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#5a1f1f",
            color: "#ffd6d6",
            padding: "10px 16px",
            borderRadius: 6,
            zIndex: 20,
          }}
        >
          {error}
        </div>
      )}
      <StartScreen />
    </>
  );
}
