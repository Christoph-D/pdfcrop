import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PDF = path.resolve(__dirname, "fixtures/sample.pdf");

test.describe("PDF crop happy path", () => {
  test("loads a PDF, renders cluster previews, and opens a cropped copy in a new tab", async ({ page }) => {
    // First run pays the cost of booting pdf.js + its worker and rasterizing
    // previews; allow plenty of room on slower CI machines.
    test.setTimeout(60_000);
    await page.goto("/");

    // Start screen is shown.
    await expect(page.getByRole("heading", { name: "PDFCrop" })).toBeVisible();
    await expect(page.getByText("Drop a PDF here")).toBeVisible();

    // Upload the fixture via the hidden file input.
    await page.locator('input[type="file"]').first().setInputFiles(SAMPLE_PDF);

    // The cropping view appears with the file name and page count. The first
    // load boots pdf.js (which falls back to a main-thread worker here) and
    // rasterizes previews, so allow a generous wait for this gate assertion.
    await expect(page.locator(".cropping-view__title")).toHaveText("sample.pdf", { timeout: 30_000 });
    await expect(page.locator(".cropping-view__count")).toContainText("4 pages");
    // The single "Crop PDF" button is now a "Crop:" label plus two actions.
    await expect(page.locator(".cropping-view__crop-label")).toHaveText("Crop:");
    await expect(page.getByRole("button", { name: "Preview" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download" })).toBeVisible();

    // At least one merged cluster preview rendered.
    await expect(page.locator(".cluster-panel__svg").first()).toBeVisible();

    // Cropping opens the cropped PDF in a new browser tab instead of
    // triggering a download. Spy on URL.createObjectURL so we can confirm the
    // cropped PDF is served from a blob URL — headless Chromium ships without
    // an inline PDF viewer, so the tab itself won't render the blob there.
    await page.evaluate(() => {
      const create = URL.createObjectURL;
      URL.createObjectURL = ((blob: Blob) => {
        const url = create.call(URL, blob);
        (window as unknown as { __blobs?: { url: string; type: string }[] }).__blobs ??= [];
        (window as unknown as { __blobs: { url: string; type: string }[] }).__blobs.push({ url, type: blob.type });
        return url;
      }) as typeof URL.createObjectURL;
    });

    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("button", { name: "Preview" }).click(),
    ]);

    // A new tab opened.
    expect(popup).toBeDefined();

    // The cropped PDF was turned into an application/pdf blob URL that the new
    // tab was pointed at (and would render inline in a real browser).
    const blobs = await page.evaluate(
      () => (window as unknown as { __blobs?: { url: string; type: string }[] }).__blobs,
    );
    expect(blobs).toEqual(expect.arrayContaining([{ url: expect.stringMatching(/^blob:/), type: "application/pdf" }]));
  });

  test("re-clusters with excluded pages, forcing them into singleton clusters", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await page.locator('input[type="file"]').first().setInputFiles(SAMPLE_PDF);
    await expect(page.locator(".cropping-view__title")).toHaveText("sample.pdf", { timeout: 30_000 });

    // Initially the 4-page fixture yields two parity clusters (odd + even).
    await expect(page.locator(".cropping-view__count")).toContainText("2 clusters");

    // Open the exclude prompt and exclude page 2.
    await page.getByRole("button", { name: "Re-cluster with excludes" }).click();
    const prompt = page.locator(".cropping-view__prompt");
    const input = prompt.locator("#exclude-input");
    await expect(input).toBeVisible();
    await input.fill("2");
    await prompt.getByRole("button", { name: "Re-cluster" }).click();

    // Page 2 becomes its own singleton, so the count rises to 3.
    await expect(page.locator(".cropping-view__count")).toContainText("3 clusters", { timeout: 30_000 });

    // The excluded singleton is labelled as such.
    await expect(page.locator(".cluster-panel__excluded")).toHaveCount(1);

    // The prompt closed.
    await expect(prompt).toHaveCount(0);
  });

  test("preserves already-drawn crop rects across a re-cluster", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await page.locator('input[type="file"]').first().setInputFiles(SAMPLE_PDF);
    await expect(page.locator(".cropping-view__count")).toContainText("2 clusters", { timeout: 30_000 });

    // Each cluster auto-seeds one crop rect on mount.
    await expect(page.locator(".cluster-panel__crop-rect")).toHaveCount(2);

    // Draw a second rect on the first (odd) cluster so it carries a rect that
    // auto-seed alone would not reproduce after re-clustering.
    const oddSvg = page.locator(".cluster-panel__svg").first();
    const box = (await oddSvg.boundingBox())!;
    const x0 = box.x + box.width * 0.2;
    const y0 = box.y + box.height * 0.2;
    const x1 = box.x + box.width * 0.8;
    const y1 = box.y + box.height * 0.8;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 5 });
    await page.mouse.up();
    // Odd cluster now has two rects, even still has one.
    await expect(page.locator(".cluster-panel__crop-rect")).toHaveCount(3);

    // Re-cluster excluding odd page 3. The old odd cluster's two rects must be
    // carried to BOTH the shrunken odd cluster and the new excluded singleton
    // (they share parity + size), while the even cluster keeps its single rect.
    await page.getByRole("button", { name: "Re-cluster with excludes" }).click();
    const prompt = page.locator(".cropping-view__prompt");
    await prompt.locator("#exclude-input").fill("3");
    await prompt.getByRole("button", { name: "Re-cluster" }).click();

    await expect(page.locator(".cropping-view__count")).toContainText("3 clusters", { timeout: 30_000 });
    // 2 (odd) + 2 (excluded singleton, inherited) + 1 (even) = 5. If transfer
    // had failed, each new panel would auto-seed exactly one -> 3.
    await expect(page.locator(".cluster-panel__crop-rect")).toHaveCount(5);
  });

  test("downloads a cropped PDF via the Download button", async ({ page }) => {
    test.setTimeout(60_000);
    // The File System Access save picker can't be driven by automation, so
    // force the <a download> fallback that emits a real download event.
    await page.addInitScript(() => {
      (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
    });
    await page.goto("/");
    await page.locator('input[type="file"]').first().setInputFiles(SAMPLE_PDF);
    await expect(page.locator(".cropping-view__title")).toHaveText("sample.pdf", { timeout: 30_000 });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("sample_cropped.pdf");
  });

  test("multiplies a cluster's pages for multiple crop rects with no slivers", async ({ page }) => {
    test.setTimeout(60_000);
    // Force the <a download> fallback so we can capture the cropped PDF as a
    // real download event and read its bytes back for inspection.
    await page.addInitScript(() => {
      (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
    });
    await page.goto("/");
    await page.locator('input[type="file"]').first().setInputFiles(SAMPLE_PDF);
    await expect(page.locator(".cropping-view__title")).toHaveText("sample.pdf", { timeout: 30_000 });

    // 4-page fixture -> two parity clusters (odd pages 1&3, even pages 2&4),
    // each auto-seeding one crop rect.
    await expect(page.locator(".cropping-view__count")).toContainText("2 clusters");
    await expect(page.locator(".cluster-panel__crop-rect")).toHaveCount(2);

    // Draw a second rect on the first (odd) cluster so each of its pages
    // (1 and 3) is emitted twice in the output.
    const oddSvg = page.locator(".cluster-panel__svg").first();
    const box = (await oddSvg.boundingBox())!;
    const x0 = box.x + box.width * 0.2;
    const y0 = box.y + box.height * 0.2;
    const x1 = box.x + box.width * 0.8;
    const y1 = box.y + box.height * 0.8;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 5 });
    await page.mouse.up();
    // Odd cluster now has two rects, even still has one.
    await expect(page.locator(".cluster-panel__crop-rect")).toHaveCount(3);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("sample_cropped.pdf");

    const dlPath = await download.path();
    expect(dlPath).toBeTruthy();
    const bytes = new Uint8Array(fs.readFileSync(dlPath!));
    const doc = await PDFDocument.load(bytes);
    const pages = doc.getPages();

    // Output order: page1 x2, page2 x1, page3 x2, page4 x1 = 6 pages.
    expect(pages.length).toBe(6);

    // Every output page owns an independent page leaf. The bug aliased one
    // leaf across all multiplied copies, so two pages shared an object number.
    const objNums = pages.map((p) => p.ref.objectNumber);
    expect(new Set(objNums).size).toBe(objNums.length);

    // Each crop stays within the original page bounds and has positive area
    // (i.e. every page is a real crop, not a degenerate box).
    for (const p of pages) {
      const mb = p.getMediaBox();
      expect(mb.width).toBeGreaterThan(0);
      expect(mb.height).toBeGreaterThan(0);
      expect(mb.x).toBeGreaterThanOrEqual(0);
      expect(mb.y).toBeGreaterThanOrEqual(0);
      expect(mb.x + mb.width).toBeLessThanOrEqual(595);
      expect(mb.y + mb.height).toBeLessThanOrEqual(842);
    }

    // The two copies of source page 1 (output pages 1 and 2) are cropped
    // independently: their MediaBoxes differ. With the bug they were identical
    // because both aliased the same page leaf.
    const p1a = pages[0]!.getMediaBox();
    const p1b = pages[1]!.getMediaBox();
    const identical = p1a.x === p1b.x && p1a.y === p1b.y && p1a.width === p1b.width && p1a.height === p1b.height;
    expect(identical).toBe(false);

    // The drawn rect is a 20%-margin crop (dragged from 20% to 80%), so its
    // ratios are [0.2, 0.2, 0.2, 0.2]. Each multiplied copy must show that crop
    // applied ONCE to the original 595x842 page -> MediaBox [119, 168.4,
    // 357x505.2]. With the bug the second copy compounded on the auto-seed
    // copy's already-shrunk leaf and collapsed to an ~18.6pt sliver. A 5pt
    // tolerance absorbs cross-browser preview rounding while still rejecting
    // the bug (whose height differs by ~480 points).
    const expectDrawnCrop = (p: (typeof pages)[number]) => {
      const mb = p.getMediaBox();
      expect(Math.abs(mb.x - 119)).toBeLessThan(5);
      expect(Math.abs(mb.y - 168.4)).toBeLessThan(5);
      expect(Math.abs(mb.width - 357)).toBeLessThan(5);
      expect(Math.abs(mb.height - 505.2)).toBeLessThan(5);
    };
    expectDrawnCrop(pages[1]!); // page 1's second (drawn) copy
    expectDrawnCrop(pages[4]!); // page 3's second (drawn) copy
  });
});
