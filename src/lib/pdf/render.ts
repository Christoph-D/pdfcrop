import * as Comlink from "comlink";
import type { Cluster } from "./cluster";
import type { GrayImage } from "./overlay";
import type { PdfWorkerApi, RenderedPage, RenderRequest } from "@/workers/pdf.worker";

let workerApi: PdfWorkerApi | null = null;
function getWorker(): PdfWorkerApi {
  if (workerApi) return workerApi;
  const worker = new Worker(new URL("../../workers/pdf.worker.ts", import.meta.url), {
    type: "module",
  });
  workerApi = Comlink.wrap<PdfWorkerApi>(worker);
  return workerApi;
}

export interface ClusterPreview {
  clusterId: string;
  preview: GrayImage;
  previewUrl: string;
}

/**
 * Renders the sampled pages for each cluster and computes a merged preview.
 * Reports progress as pages complete (0..1).
 */
export async function renderClusterPreviews(
  data: ArrayBuffer,
  clusters: Cluster[],
  password: string | null,
  onProgress?: (done: number, total: number) => void,
): Promise<ClusterPreview[]> {
  const worker = getWorker();
  const dataCopy = data.slice(0);

  // Copy the buffer once per render; the worker keeps a cache keyed by size.
  const requests: Array<{ cluster: Cluster; pages: Promise<RenderedPage>[] }> = clusters.map(
    (cluster) => ({
      cluster,
      pages: cluster.pagesToMerge.map((pageNumber) => {
        const req: RenderRequest = {
          // Each call gets its own copy because transferable would invalidate
          // future calls; pdf.js copies internally anyway.
          data: dataCopy.slice(0),
          password: password ?? undefined,
          pageNumber,
        };
        return worker.renderPage(Comlink.transfer(req, []));
      }),
    }),
  );

  const total = requests.reduce((acc, r) => acc + r.pages.length, 0);
  let done = 0;

  // Track per-page resolution for progress reporting.
  const wrapped = requests.map((r) => ({
    cluster: r.cluster,
    pages: r.pages.map(async (p): Promise<RenderedPage> => {
      const result = await p;
      done += 1;
      onProgress?.(done, total);
      return result;
    }),
  }));

  const previews = await Promise.all(
    wrapped.map(async ({ cluster, pages }) => {
      const rendered = await Promise.all(pages);
      const result = await worker.computeClusterOverlay(cluster.id, rendered);
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
    }),
  );

  void worker.dispose();
  return previews;
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
