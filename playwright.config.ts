import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for PDFCrop end-to-end tests.
 *
 * `pnpm test:e2e` runs these. The dev server (Vite) is started automatically
 * by the `webServer` block; in CI a fresh server is booted, locally an already
 * running `pnpm dev` is reused.
 */
const PORT = 5173;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // The PDF pipeline boots pdf.js + a worker and rasterizes previews on first
    // load, which can take several seconds — give auto-retrying assertions room.
    expect: { timeout: 20_000 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
