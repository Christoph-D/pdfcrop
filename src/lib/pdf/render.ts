import * as Comlink from "comlink";
import type { Cluster } from "./cluster";
import type { GrayImage } from "./overlay";
import type { DocumentConfig, DocumentHandle, PdfWorkerApi, RenderedPage } from "@/workers/pdf.worker";

export interface ClusterPreview {
  clusterId: string;
  preview: GrayImage;
  previewUrl: string;
}

interface WorkerHandle {
  api: PdfWorkerApi;
  /** Document loaded into this worker (parsed once, reused for every page). */
  handle?: DocumentHandle;
  /** Approximate count of in-flight tasks, for least-busy scheduling. */
  inFlight: number;
  terminate: () => void;
}

function createWorker(): WorkerHandle {
  const worker = new Worker(new URL("../../workers/pdf.worker.ts", import.meta.url), {
    type: "module",
  });
  return { api: Comlink.wrap<PdfWorkerApi>(worker), inFlight: 0, terminate: () => worker.terminate() };
}

/**
 * Fixed-size pool of render workers. Each task (page rasterization, overlay
 * computation) is dispatched to the least-busy worker so the heavy work for
 * large PDFs runs in parallel instead of serializing through a single worker.
 */
class WorkerPool {
  readonly workers: readonly WorkerHandle[];

  constructor(size: number) {
    this.workers = Array.from({ length: size }, createWorker);
  }

  /** Fewest in-flight tasks; ties resolve to the earliest worker. */
  pick(): WorkerHandle {
    let best = this.workers[0]!;
    for (const w of this.workers) {
      if (w.inFlight < best.inFlight) best = w;
    }
    return best;
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
  }
}

/** Smallest pool worth spinning up once there is enough work to split. */
const MIN_POOL_SIZE = 2;
/** Cap so many-core hosts don't pay for redundant PDF parses / workers. */
const MAX_POOL_SIZE = 8;

/**
 * Choose a pool size that scales with the host but never exceeds the amount of
 * parallelizable work. A single page (or none) keeps a single worker so small
 * PDFs aren't penalized by needless worker startup.
 */
function pickPoolSize(workUnits: number): number {
  if (workUnits <= 1) return 1;
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  // Reserve a core for the main thread (UI / progress / data-URL encoding).
  const byCores = Math.min(MAX_POOL_SIZE, Math.max(MIN_POOL_SIZE, cores - 1));
  return Math.min(byCores, workUnits);
}

/**
 * Renders the sampled pages for each cluster and computes a merged preview.
 *
 * Work is spread across a pool of workers (sized to the host) rather than a
 * single worker. Each worker parses the PDF once and then renders many pages
 * from that one document — mirroring Briss's `PDFImageExtractor`, which opens
 * the PDF a single time instead of re-parsing it per page. Both the per-page
 * rasterization and the per-cluster overlay math are dispatched to the
 * least-busy worker. Progress is reported as pages complete (0..1).
 */
export async function renderClusterPreviews(
  data: ArrayBuffer,
  clusters: Cluster[],
  onProgress?: (done: number, total: number) => void,
): Promise<ClusterPreview[]> {
  const jobs = clusters.flatMap((cluster) => cluster.pagesToMerge.map((pageNumber) => ({ cluster, pageNumber })));
  if (jobs.length === 0) return [];

  const total = jobs.length;
  const pool = new WorkerPool(pickPoolSize(total));

  try {
    // Resolve BASE_URL against the document: with the relative base ("./") a
    // raw "./standard_fonts/" would resolve against the worker's location in
    // dist/assets/ instead of the app root.
    const assetBase = new URL(import.meta.env.BASE_URL, document.baseURI).href;
    const baseConfig = {
      standardFontDataUrl: `${assetBase}standard_fonts/`,
      cMapUrl: `${assetBase}cmaps/`,
    } satisfies Pick<DocumentConfig, "standardFontDataUrl" | "cMapUrl">;

    // Load the PDF once per worker. Each worker receives its own transferred
    // copy of the bytes and reuses the parsed document for every page it
    // renders, instead of re-parsing the whole PDF for each page.
    await Promise.all(
      pool.workers.map(async (w) => {
        const req: DocumentConfig = { ...baseConfig, data: data.slice(0) };
        w.handle = await w.api.loadDocument(Comlink.transfer(req, [req.data]));
      }),
    );

    // Dispatch every page render to the least-busy worker, recording each
    // result against its cluster for the overlay pass.
    const renderedByCluster = new Map<string, Promise<RenderedPage>[]>();
    for (const cluster of clusters) renderedByCluster.set(cluster.id, []);
    let done = 0;

    for (const { cluster, pageNumber } of jobs) {
      const worker = pool.pick();
      worker.inFlight++;
      const rendered = worker.api
        .renderPage(worker.handle!.id, pageNumber)
        .then((page): RenderedPage => {
          done += 1;
          onProgress?.(done, total);
          return page;
        })
        .finally(() => {
          worker.inFlight--;
        });
      renderedByCluster.get(cluster.id)!.push(rendered);
    }

    // Once a cluster's pages are all rendered, compute its overlay on whichever
    // worker is free. Tracking in-flight keeps overlay work spread across the
    // pool too — otherwise every cluster would pile onto worker 0.
    const previews = await Promise.all(
      clusters.map(async (cluster): Promise<ClusterPreview> => {
        const pages = await Promise.all(renderedByCluster.get(cluster.id) ?? []);
        const worker = pool.pick();
        worker.inFlight++;
        try {
          const result = await worker.api.computeClusterOverlay(cluster.id, pages);
          if (!result) {
            return {
              clusterId: cluster.id,
              preview: { width: 1, height: 1, data: new Uint8Array([255]) },
              previewUrl: "",
            };
          }
          return {
            clusterId: cluster.id,
            preview: result.preview,
            previewUrl: grayToDataUrl(result.preview),
          };
        } finally {
          worker.inFlight--;
        }
      }),
    );

    return previews;
  } finally {
    // Release each worker's parsed document, then tear the pool down.
    await Promise.all(
      pool.workers.map(async (w) => {
        if (!w.handle) return;
        try {
          await w.api.unloadDocument(w.handle.id);
        } catch {
          // Worker may already be gone; termination below is best-effort.
        }
      }),
    );
    pool.terminate();
  }
}

function grayToDataUrl(gray: GrayImage): string {
  const canvas = document.createElement("canvas");
  canvas.width = gray.width;
  canvas.height = gray.height;
  const ctx = canvas.getContext("2d")!;
  const rgba = new Uint8ClampedArray(gray.width * gray.height * 4);
  for (let i = 0, j = 0; i < gray.data.length; i++, j += 4) {
    const v = gray.data[i]!;
    rgba[j] = v;
    rgba[j + 1] = v;
    rgba[j + 2] = v;
    rgba[j + 3] = 255;
  }
  const imgData = ctx.createImageData(gray.width, gray.height);
  imgData.data.set(rgba);
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL("image/png");
}
