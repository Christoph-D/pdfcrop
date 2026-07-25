import net from "node:net";

import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for PDFCrop end-to-end tests.
 *
 * `pnpm test:e2e` runs these. Each run reserves its own random free port and
 * boots a fresh Vite dev server on it, so the tests can never accidentally
 * attach to a stale `pnpm dev` process (e.g. one serving old code) that might
 * already be listening. The dev server is started automatically by the
 * `webServer` block.
 *
 * Why the port is chosen this way:
 *
 * - Playwright evaluates this config module in *multiple* processes (the runner
 *   that owns the `webServer`, plus each worker that runs tests). Computing a
 *   fresh random port on every load would hand the runner and the workers
 *   *different* ports, so `baseURL` would point at a server that never started.
 *   We therefore reserve the port once and stash it in `process.env.E2E_PORT`;
 *   the workers are forked from the runner after it loads the config, so they
 *   inherit that environment variable and reuse the same port.
 *
 * - Reserving and serving on `127.0.0.1` (instead of `localhost`) avoids an
 *   IPv4/IPv6 split: on some hosts Vite binds `localhost` to `::1` while the
 *   headless browser resolves `localhost` to `127.0.0.1`, producing
 *   `ERR_CONNECTION_REFUSED`.
 *
 * The reservation happens at config-load time via top-level await (this project
 * ships as an ESM module, so Playwright loads the config as ESM and the await
 * resolves before the config object is exported).
 */

/** Reserve a free TCP port by binding to port 0 and reading the assigned port. */
function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen({ port: 0, host: "127.0.0.1" }, () => {
      const address = server.address();
      if (address == null || typeof address === "string") {
        reject(new Error("could not determine the assigned port"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

// First process to load the config reserves a port; every forked worker
// inherits E2E_PORT and reuses it instead of picking its own.
const PORT =
  process.env.E2E_PORT && process.env.E2E_PORT !== "0" ? Number(process.env.E2E_PORT) : await reserveFreePort();
process.env.E2E_PORT = String(PORT);

const HOST = "127.0.0.1";
const baseURL = `http://${HOST}:${PORT}`;

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
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT} --strictPort --host ${HOST}`,
    url: baseURL,
    // We reserved a free port, so there is nothing meaningful to reuse. Always
    // start our own server to guarantee it serves the current code.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
