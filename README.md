# PDFCrop

A browser-based tool for cropping PDFs. Drop in a PDF, draw crop rectangles over the auto-generated page clusters, and
download a cropped copy. Everything runs in your browser — no server, no upload, nothing leaves your machine.

PDFCrop is a reimplementation of the desktop application [Briss-2.0](https://github.com/mbaeuerle/Briss-2.0) (see
[Attribution](#attribution) below).

Live version: https://christoph-d.github.io/pdfcrop/.

## What it does

- **Clustered previews.** Pages are grouped by size and even/odd parity, then merged into a single preview image per
  cluster so you can see the union of content across many pages at once — the same trick Briss uses to make consistent
  crops across a whole document.
- **Manual crop rectangles.** Draw, move, resize, and delete crop rectangles on any cluster.
- **Auto-crop.** Optionally infer the crop rectangle for a cluster from the merged preview's content.
- **Size sync.** Propagate one rectangle's dimensions to every other cluster, so e.g. all even/odd pages end up the same
  size.
- **Encrypted PDFs.** Prompts for a password when needed.
- **Local-only.** All parsing, rendering, and cropping happen client-side using
  [pdf.js](https://mozilla.github.io/pdf.js/) (read), [pdf-lib](https://pdf-lib.js.org/) (write), and a Web Worker for
  the heavy rasterization and overlay math.

See [`TODO.md`](./TODO.md) for the Briss features that are not yet ported (cross-panel multi-select, split into
columns/rows, copy/paste rects, etc.).

## How to run it

Requires Node.js (tested on the LTS line) and [pnpm](https://pnpm.io). The pnpm version is pinned in
`package.json` via the `packageManager` field; run `corepack enable` if you don't already have pnpm.

```bash
pnpm install
pnpm dev
```

Then open the URL Vite prints (typically `http://localhost:5173`).

### Other scripts

| Script               | Purpose                                             |
| -------------------- | --------------------------------------------------- |
| `pnpm build`         | Type-check and produce a static build in `dist/`.   |
| `pnpm preview`       | Serve the built `dist/` locally for a sanity check. |
| `pnpm lint`          | Run ESLint.                                         |
| `pnpm typecheck`     | Run `tsc --noEmit`.                                 |
| `pnpm test`          | Run the unit tests once (`vitest run`).             |
| `pnpm test:watch`    | Run vitest in watch mode.                           |

## How to deploy it

```bash
pnpm build
```

This produces a minified, fully static build in `dist/`. The contents of `dist/` must be served by a web server (opening
the files directly from disk will not work); any static host or local server will do.

## License

Copyright (c) the PDFCrop authors.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public
License Version 3 as published by the Free Software Foundation.

The full license text is in [`LICENSE`](./LICENSE).

### Attribution

PDFCrop is a from-scratch reimplementation of the ideas and user experience of
**[Briss-2.0](https://github.com/mbaeuerle/Briss-2.0)**, originally based on
[Briss](https://sourceforge.net/projects/briss/). The clustering, preview-merging, auto-crop, and ratio-based cropping
algorithms here are ports of Briss's Java implementation to TypeScript and the browser. Briss-2.0 is licensed under the
GNU General Public License v3.
