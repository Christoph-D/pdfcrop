import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// `sample.pdf` is generated with `StandardFonts.HelveticaBold`, which pdf-lib
// references as a base-14 font WITHOUT embedding the font program — the exact
// case where pdf.js needs its `standard_fonts/` assets to avoid blank boxes.
const SAMPLE_PDF = path.resolve(__dirname, "fixtures/sample.pdf");

test.describe("non-embedded font rendering", () => {
  test("renders glyphs from fetched standard-font data, not blank boxes", async ({ page }) => {
    // Regression guard for the worker's pdf.js config. The render worker has
    // no `document`, so pdf.js must run with `disableFontFace: true` and
    // `useSystemFonts: false`; otherwise non-embedded fonts show up as blank
    // boxes.
    const standardFontUrls: string[] = [];
    page.on("response", (res) => {
      const u = res.url();
      if (/\/standard_fonts\/.+\.(pfb|ttf|otf|woff2?)$/.test(u) && res.status() === 200) {
        standardFontUrls.push(u);
      }
    });

    await page.goto("/");
    await page.locator('input[type="file"]').first().setInputFiles(SAMPLE_PDF);
    await expect(page.locator(".cluster-panel__svg").first()).toBeVisible();
    // (1) pdf.js actually pulls the standard-font program for Helvetica-Bold
    //     (e.g. LiberationSans-Bold.ttf) and gets 200. This fetch is triggered
    //     lazily while the first pages rasterize, so poll until one lands.
    await expect.poll(() => standardFontUrls.length, { message: JSON.stringify(standardFontUrls) }).toBeGreaterThan(0);

    // (2) The rendered preview contains real glyph strokes, not solid .notdef
    //     rectangles. Real text yields many short dark horizontal "runs"; a
    //     blank-box page yields a handful of long solid runs.
    const stats = await page
      .locator(".cluster-panel__svg")
      .first()
      .evaluate((svg) => {
        const img = svg.querySelector("image") as SVGImageElement | null;
        if (!img) return null;
        const href = img.getAttribute("href") ?? img.getAttribute("xlink:href") ?? "";
        return new Promise<{ dark: number; runs: number } | null>((resolve) => {
          const el = new Image();
          el.onload = () => {
            const d = document.createElement("canvas");
            d.width = el.width;
            d.height = el.height;
            const cx = d.getContext("2d")!;
            cx.drawImage(el, 0, 0);
            const { data } = cx.getImageData(0, 0, d.width, d.height);
            let dark = 0;
            let runs = 0;
            let inRun = false;
            for (let y = 0; y < d.height; y++) {
              for (let x = 0; x < d.width; x++) {
                const isDark = data[(y * d.width + x) * 4]! < 128;
                if (isDark) dark++;
                if (isDark && !inRun) {
                  runs++;
                  inRun = true;
                } else if (!isDark) {
                  inRun = false;
                }
              }
              inRun = false;
            }
            resolve({ dark, runs });
          };
          el.onerror = () => resolve(null);
          el.src = href;
        });
      });

    expect(stats, "preview image decoded").not.toBeNull();
    expect(stats!.dark, "preview should contain ink").toBeGreaterThan(200);
    expect(stats!.runs, "preview should have many glyph runs, not solid boxes").toBeGreaterThan(50);
  });
});
