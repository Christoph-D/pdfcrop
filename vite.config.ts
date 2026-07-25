import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

// pdf.js fetches these at runtime; without them, glyphs from non-embedded
// standard fonts (Helvetica, ...) and named-CMap CID fonts render as blank
// boxes. Read straight out of pdfjs-dist — copied to dist at build time
// (kept out of public/ to avoid committing the binaries).
const PDFJS_DIST = path.resolve(__dirname, "node_modules/pdfjs-dist");
const PDFJS_STATIC_DIRS = ["standard_fonts", "cmaps"] as const;

function pdfjsStaticAssets(): Plugin {
  let outDir = path.resolve(__dirname, "dist");

  const serveStatic: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url ?? "").split("?")[0] ?? "";
    for (const dir of PDFJS_STATIC_DIRS) {
      const prefix = `/${dir}/`;
      if (!url.startsWith(prefix)) continue;
      const rel = decodeURIComponent(url.slice(prefix.length));
      if (!rel || rel.includes("..")) {
        res.statusCode = 400;
        res.end();
        return;
      }
      const file = path.join(PDFJS_DIST, dir, rel);
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) {
          next();
          return;
        }
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", st.size);
        fs.createReadStream(file).pipe(res);
      });
      return;
    }
    next();
  };

  return {
    name: "pdfjs-static-assets",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use(serveStatic);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveStatic);
    },
    writeBundle() {
      for (const dir of PDFJS_STATIC_DIRS) {
        const from = path.join(PDFJS_DIST, dir);
        if (fs.existsSync(from)) {
          fs.cpSync(from, path.join(outDir, dir), { recursive: true });
        }
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), pdfjsStaticAssets()],
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
