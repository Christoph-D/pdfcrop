import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    // `pdf.worker.mjs` is imported from inside the Comlink render worker
    // (`src/workers/pdf.worker.ts`), which Vite's static scanner can't see. If
    // it isn't pre-bundled, Vite discovers it at runtime when the worker boots
    // (i.e. when a user loads a PDF), re-optimizes, and forces a full page
    // reload that wipes the in-progress load. Pre-bundle it so the dev server
    // is stable from the first request (fixes flaky e2e cold-cache run).
    include: ["pdfjs-dist/build/pdf.worker.mjs"],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
