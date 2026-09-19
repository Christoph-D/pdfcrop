import { defineConfig } from "vitest/config";
import type { Connect, Plugin } from "vite";
import type { ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

// pdf.js fetches these at runtime; without them, glyphs from non-embedded
// standard fonts (Helvetica, ...) and named-CMap CID fonts render as blank
// boxes. The worker script is served the same way: in dev, Vite would
// otherwise run it through its transform pipeline, injecting the HMR client
// (`/@vite/client`, which opens a WebSocket) into pdf.js's worker — that
// deadlocks rasterization in Firefox. Serving the file verbatim keeps the
// worker pristine (production uses the untouched `?url` asset instead; see
// read.ts). Both read straight out of pdfjs-dist (kept out of public/ to
// avoid committing the binaries).
const PDFJS_DIST = path.resolve(import.meta.dirname, "node_modules/pdfjs-dist");
const PDFJS_STATIC_DIRS = ["standard_fonts", "cmaps"] as const;
const PDFJS_WORKER_FILE = "pdf.worker.min.mjs";
const PDFJS_WORKER_PATH = `/${PDFJS_WORKER_FILE}`;

const CONTENT_TYPES: Record<string, string> = {
  ".mjs": "text/javascript",
  ".js": "text/javascript",
};

function pdfjsStaticAssets(): Plugin {
  let outDir = path.resolve(import.meta.dirname, "dist");

  const serveFile = (res: ServerResponse, file: string) => {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader("Content-Type", CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream");
      res.setHeader("Content-Length", st.size);
      fs.createReadStream(file).pipe(res);
    });
  };

  const serveStatic: Connect.NextHandleFunction = (req, res, next) => {
    const url = (req.url ?? "").split("?")[0] ?? "";
    if (url === PDFJS_WORKER_PATH) {
      serveFile(res, path.join(PDFJS_DIST, "build", PDFJS_WORKER_FILE));
      return;
    }
    for (const dir of PDFJS_STATIC_DIRS) {
      const prefix = `/${dir}/`;
      if (!url.startsWith(prefix)) continue;
      const rel = decodeURIComponent(url.slice(prefix.length));
      if (!rel || rel.includes("..")) {
        res.statusCode = 400;
        res.end();
        return;
      }
      serveFile(res, path.join(PDFJS_DIST, dir, rel));
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
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  server: {
    watch: {
      // Ignore hidden files and directories
      ignored: [/(^|[/\\])\.[^/]/],
    },
  },
  worker: {
    format: "es",
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
