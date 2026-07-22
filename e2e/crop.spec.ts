import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PDF = path.resolve(__dirname, "fixtures/sample.pdf");

test.describe("PDF crop happy path", () => {
  test("loads a PDF, renders cluster previews, and exports a cropped copy", async ({ page }) => {
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
    await expect(page.getByRole("button", { name: "Crop PDF" })).toBeVisible();

    // At least one merged cluster preview rendered.
    await expect(page.locator(".cluster-panel__svg").first()).toBeVisible();

    // Chromium exposes showSaveFilePicker, but in headless mode it rejects with
    // NotAllowedError, which the app treats as "user cancelled". Disable it so
    // we exercise the <a download> fallback used by Firefox/Safari instead.
    await page.evaluate(() => {
      (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
    });

    // Cropping triggers a download of the cropped file.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Crop PDF" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("sample_cropped.pdf");
  });
});
