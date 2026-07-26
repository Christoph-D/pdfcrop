import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the heavy crop + DOM-touching helpers so the cache logic can be tested
// in the node environment without pdf-lib or a real DOM. `croppedFileName` is
// kept real so the produced filename is asserted end-to-end.
vi.mock("@/lib/pdf/write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pdf/write")>();
  return { ...actual, cropPdf: vi.fn() };
});
vi.mock("@/lib/download", () => ({
  openBytesInTab: vi.fn(() => null),
  saveFile: vi.fn(async () => {}),
}));

import { cropPdf } from "@/lib/pdf/write";
import { openBytesInTab, saveFile } from "@/lib/download";
import type { PdfSource } from "@/lib/pdf/types";
import { useCropStore, type CropRect } from "./cropStore";
import { useWorkspaceStore } from "./workspaceStore";

const cropPdfMock = vi.mocked(cropPdf);
const openBytesInTabMock = vi.mocked(openBytesInTab);
const saveFileMock = vi.mocked(saveFile);

function rect(id: string): CropRect {
  return { id, x: 10, y: 10, w: 40, h: 60 };
}

function fakeSource(fileName = "sample.pdf"): PdfSource {
  return {
    data: new ArrayBuffer(1),
    fileName,
    pages: [
      { pageNumber: 1, width: 595, height: 842, rotation: 0 },
      { pageNumber: 2, width: 595, height: 842, rotation: 0 },
    ],
  };
}

const OUTPUT = { bytes: new Uint8Array([1, 2, 3, 4]), outlinePreserved: true, outputPageCount: 2 };

beforeEach(() => {
  cropPdfMock.mockReset();
  openBytesInTabMock.mockReset();
  saveFileMock.mockReset();
  cropPdfMock.mockResolvedValue({ ...OUTPUT });
  openBytesInTabMock.mockReturnValue(null);
  saveFileMock.mockResolvedValue(undefined);
  useWorkspaceStore.getState().reset();
  useCropStore.getState().clearAll();
});

describe("crop cache", () => {
  it("crops once and reuses the bytes for both Preview and Download", async () => {
    useWorkspaceStore.getState().setSource(fakeSource());

    await useWorkspaceStore.getState().cropPreview();
    await useWorkspaceStore.getState().cropDownload();

    // cropPdf ran exactly once; the Download click reused the cached bytes.
    expect(cropPdfMock).toHaveBeenCalledTimes(1);
    expect(openBytesInTabMock).toHaveBeenCalledTimes(1);
    expect(saveFileMock).toHaveBeenCalledTimes(1);
    expect(saveFileMock.mock.calls[0]![1]).toMatchObject({ suggestedName: "sample_cropped.pdf" });
    expect(useWorkspaceStore.getState().croppedCache?.fileName).toBe("sample_cropped.pdf");
  });

  it("re-runs cropPdf after a Preview once the cache is cleared", async () => {
    useWorkspaceStore.getState().setSource(fakeSource());
    await useWorkspaceStore.getState().cropPreview();
    expect(cropPdfMock).toHaveBeenCalledTimes(1);

    useWorkspaceStore.getState().clearCroppedCache();
    await useWorkspaceStore.getState().cropDownload();
    expect(cropPdfMock).toHaveBeenCalledTimes(2);
  });
});

describe("crop cache invalidation from cropStore", () => {
  beforeEach(async () => {
    useWorkspaceStore.getState().setSource(fakeSource());
    await useWorkspaceStore.getState().cropPreview();
    expect(useWorkspaceStore.getState().croppedCache).not.toBeNull();
  });

  for (const action of ["addRect", "updateRect", "removeRect", "replaceRect"] as const) {
    it(`${action} clears the cache`, () => {
      const store = useCropStore.getState();
      // Seed a rect so update/remove/replace have a target.
      store.setRects("A", [rect("a1")]);
      // setRects itself clears the cache; repopulate before the action.
      useWorkspaceStore.setState({ croppedCache: { bytes: OUTPUT.bytes, fileName: "sample_cropped.pdf" } });
      switch (action) {
        case "addRect":
          store.addRect("A", rect("a2"));
          break;
        case "updateRect":
          store.updateRect("A", "a1", { w: 99 });
          break;
        case "removeRect":
          store.removeRect("A", "a1");
          break;
        case "replaceRect":
          store.replaceRect("A", "a1", [rect("a2"), rect("a3")]);
          break;
      }
      expect(useWorkspaceStore.getState().croppedCache).toBeNull();
    });
  }

  it("replaceAllRects clears the cache", () => {
    useWorkspaceStore.setState({ croppedCache: { bytes: OUTPUT.bytes, fileName: "sample_cropped.pdf" } });
    useCropStore.getState().replaceAllRects({ A: [rect("a1")] });
    expect(useWorkspaceStore.getState().croppedCache).toBeNull();
  });

  it("selection-only changes do not clear the cache", () => {
    const store = useCropStore.getState();
    store.setRects("A", [rect("a1")]);
    useWorkspaceStore.setState({ croppedCache: { bytes: OUTPUT.bytes, fileName: "sample_cropped.pdf" } });
    store.toggleSelect("a1");
    store.selectOnly("a1");
    store.clearSelection();
    expect(useWorkspaceStore.getState().croppedCache).not.toBeNull();
  });
});

describe("preview timing", () => {
  it("logs elapsed ms from load start to setPreviews and clears the timer", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    useWorkspaceStore.setState({ loadStartedAt: performance.now() });

    useWorkspaceStore.getState().setPreviews([]);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]![0]).toMatch(/preview ready in \d+ ms/);
    expect(useWorkspaceStore.getState().loadStartedAt).toBeNull();
    logSpy.mockRestore();
  });

  it("does not log when no load was started (e.g. a re-cluster)", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    useWorkspaceStore.getState().setPreviews([]);

    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
