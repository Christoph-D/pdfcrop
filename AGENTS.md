# AGENTS.md

## Project

PDFCrop is a browser-based PDF cropping tool. Everything runs client-side: no server, no upload. See `README.md` for the
full description.

### Stack

- **Build/dev:** Vite, TypeScript (`tsc -b`), pnpm.
- **UI:** React 18. State is managed with Zustand stores in `src/store/` (`workspaceStore` for PDF source/loading
  lifecycle, `cropStore` for crop rectangles and selections).
- **PDF reading:** [`pdf.js`](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`).
- **PDF writing:** [`pdf-lib`](https://pdf-lib.js.org/).
- **Heavy work** (rasterization, preview merging) runs in a Web Worker via
  [`comlink`](https://github.com/GoogleChromeLabs/comlink): `src/workers/pdf.worker.ts`.
- **Tests:** Vitest, co-located as `*.test.ts` next to the code under test.

### Key source layout

- `src/lib/pdf/` — the core algorithms, each a port of the equivalent Briss logic:
  - `read.ts` (parse with pdf.js), `write.ts` (crop with pdf-lib)
  - `cluster.ts` (group pages by size + even/odd parity), `render.ts` (merge a cluster's pages into one preview)
  - `overlay.ts` (union-of-content math for merged previews), `autocrop.ts` (infer crop rect from content)
  - `ratios.ts` (ratio-based / size-sync cropping)
  - `types.ts` (shared types: `PdfSource`, `PageMetadata`, `Rotation`)
- `src/components/` — React UI (`StartScreen`, `CroppingView`, `ClusterPanel`, `ProgressBar`, `ErrorBanner`).
- `src/store/` — Zustand stores.
- `src/hooks/usePdfLoader.ts` — loads the dropped PDF into the worker.
- `src/App.tsx` — top-level component: drives clustering → rendering → ready lifecycle.

`TODO.md` tracks Briss features not yet ported.

## After every change

You MUST run `format` and `check` after making any change:

```sh
pnpm format
pnpm check
```

`pnpm check` runs lint, typecheck, tests, and format:check. Do not consider a task complete until both commands pass.
