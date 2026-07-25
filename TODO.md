# TODO — Features Deferred from Briss Parity

This document tracks Briss features that the MVP+autocrop scope intentionally skipped. Each item references the original
Java source for porting reference.

## Cross-panel selection broadcast (high value)

Briss's defining UX: dragging/resizing/moving a selected crop rectangle applies the same delta to selected rectangles in
**every** cluster panel simultaneously.

- Original: `BrissGUIApp` interface methods `alignSelRects`, `moveSelectedRects`, `resizeSelRects`,
  `resizeAndMoveSelectedRects`, `deselectAllRects` (called from `MergedPanel`).
- Current state: `cropStore` only supports a single `(selectedClusterId, selectedRectId)` pair — no multi-select across
  panels.
- To port:
  - Add `selectedRectIds: Set<string>` (global), drop the single-cluster constraint.
  - Add store actions that take a delta patch and apply it to every selected rect regardless of cluster.
  - In `ClusterPanel`, Shift+click toggles membership in the global set; plain click replaces it.
  - Keyboard shortcuts (below) operate over the whole set.

## Keyboard shortcuts

| Key                  | Mod              | Action                                                  | Source                           |
| -------------------- | ---------------- | ------------------------------------------------------- | -------------------------------- |
| `Delete`/`Backspace` | —                | Delete selected (already implemented for single-select) | `MergedPanelKeyAdapter`          |
| `←/→/↑/↓`            | —                | Move selected by 1px                                    | `MergedPanelKeyAdapter`          |
| `←/→/↑/↓`            | `Shift`          | Move by 10px                                            | ″                                |
| `←/→/↑/↓`            | `Ctrl/Cmd`       | Resize by (±1,±1) instead of move                       | ″                                |
| `←/→/↑/↓`            | `Shift+Ctrl/Cmd` | Resize by (±10,±10)                                     | ″                                |
| `Esc`                | —                | Deselect all (already implemented)                      | ″                                |
| `Ctrl/Cmd+C` / `V`   | —                | Copy/paste rects between clusters (see below)           | ″                                |
| `L`                  | —                | Trigger load-file picker                                | `BrissSwingGUI` menu accelerator |

## Split into columns / rows — ✅ done

Right-click context menu on a selected rect: replace it with two crops by finding the minimum-content-variance seam near
the horizontal/vertical middle. Implemented in `src/lib/pdf/split.ts` and surfaced as a context menu in `ClusterPanel`.

- Original: `SplitFinder.splitColumn` / `splitRow`, exposed via `PopUpMenuForCropRectangles` in `MergedPanel`.
- Algorithm port: 1-D argmin of `sdOfDerivation` over the middle ±5% window. Row split introduces a
  `ROW_OVERLAP_RATIO = 0.01` overlap so the two halves share a sliver (prevents clipping ascenders/descenders).
- Constants: `LOOK_RATIO = 0.5`, `MAX_DIST_RATIO = 0.1`.
- Note: unlike Briss (which computed the seam over the whole merged preview and carried a TODO to scope it to the crop),
  the projection here runs only over the rect's pixels, so the seam is found near the _rect's_ middle.

## Copy / paste crop rectangles

In-memory clipboard (NOT the OS clipboard) for moving rect layouts between clusters.

- Original: `gui/ClipBoard.java` singleton; `copyToClipBoard` clears first, `pasteFromClipBoard` appends copies (pasted
  rects start unselected).
- To port: add `clipboard: CropRect[]` to `cropStore` plus `copy()`/`paste()` actions; bind Ctrl/Cmd+C and Ctrl/Cmd+v at
  the panel level (intercept before the browser's real clipboard).

## Align selected rectangles

Sets every selected rect in every panel to the same x/y/w/h as a reference.

- Original: `BrissGUIApp.alignSelRects(x, y, w, h)` invoked from the context-menu handler with the topmost rect under
  the cursor.
- Depends on cross-panel broadcast (above) to be meaningful.

## Exclude pages

Optional page-exclusion prompt before clustering, forcing excluded pages into their own singleton clusters so they don't
pollute the merged preview.

- Original: `BrissSwingGUI.getExcludedPages` → `PageNumberParser` (syntax: `1-4;6;9`) → `PageExcludes` consumed by
  `ClusterCreator.clusterPages`.
- To port:
  - Add an optional "Re-cluster with excludes" action in the cropping view.
  - Extend `clusterPages(pages, excludes?)` so excluded pages get a unique cluster id each.
  - Preserve existing user-drawn rects on re-cluster (port of `BrissSwingGUI.copyCropsToClusters` — match by
    `(parity, roundedW, roundedH)` and copy ratios over).

## Zoom

Manual zoom in/out/reset/fit, plus mouse wheel scrolling/mouse panning.

- Original: `BrissSwingGUI.zoomBy`, `setZoom`, `fitToWindow`; constants `MIN_ZOOM=0.1`, `MAX_ZOOM=10.0`,
  `ZOOM_STEP=1.25`, `FIT_PADDING=0.95`.
- Browser equivalent: a `zoom` value in `workspaceStore`, applied as a CSS `transform: scale()` on the cluster grid (or
  as a CSS variable driving `max-width` on `.cluster-panel`).
- Auto-fit on load and on container resize is already effectively done by the current flex/grid; manual zoom is the
  missing piece.
- Standard mouse wheel scrolling/left click panning like in a map.

## Persisted crop settings (export / import)

Save the per-cluster ratios to a JSON file so the same crop can be re-applied to a related PDF later.

- Original: `ExportImportHelper` (entirely commented out — never shipped).
- Suggested schema (from the architecture plan):
  ```json
  {
    "excludes": [5, 7, 9],
    "clusters": [{ "even": true, "w": 595, "h": 842, "ratios": [[0.05, 0.05, 0.05, 0.05]] }]
  }
  ```
- Reconciliation on import: re-run `clusterPages`, match saved clusters to live ones by `(parity, roundedW, roundedH)`,
  copy ratios over.

## Outline preservation when page multiplication occurs

Current policy: if any cluster has >1 rect, the entire outline tree is dropped with a UI warning.

- Original: `DocumentCropper` shifts bookmark targets via `SimpleBookmark.shiftPageNumbers` after page duplication.
- To port: pdf-lib exposes `outDoc.catalog.get("Outlines")`; you'd need to walk the destination tree and rewrite `Dest`
  / `Page` references to the new multiplied-page indices. Most-fidelity, most-work option.

## Performance optimizations

- Move `calculateOverlay` and per-page rasterization behind a worker pool (more than the single current worker) for
  large PDFs.

## Better-fidelity porting details

- `DrawableCropRect` draws a size label on selected rects showing `WxH mm  1:ratio`. Not ported — would be a small SVG
  `<text>` per selected rect using the `INCH_IN_USER_UNIT = 72` and `INCH_IN_MILLIMETERS = 25.4` conversion from
  `DrawableCropRect.draw`.
