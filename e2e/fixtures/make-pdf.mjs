// Generates the small multi-page PDF used by the Playwright end-to-end tests.
// Run with: pnpm gen:fixture   (re-runs are idempotent)
import { fileURLToPath } from "node:url";
import path from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "sample.pdf");

const PAGES = [
  { label: "Odd page 1", color: rgb(0.2, 0.4, 0.8) },
  { label: "Even page 2", color: rgb(0.8, 0.3, 0.3) },
  { label: "Odd page 3", color: rgb(0.2, 0.6, 0.3) },
  { label: "Even page 4", color: rgb(0.6, 0.3, 0.7) },
];

async function main() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595;
  const H = 842;
  const margin = 64;

  for (const { label, color } of PAGES) {
    const page = doc.addPage([W, H]);
    // Drawn content (border + titled banner) so the auto-crop / preview
    // pipeline has actual ink to detect rather than a blank page.
    page.drawRectangle({
      x: margin,
      y: margin,
      width: W - margin * 2,
      height: H - margin * 2,
      borderColor: color,
      borderWidth: 3,
    });
    page.drawRectangle({
      x: margin + 20,
      y: H - margin - 80,
      width: 320,
      height: 60,
      color: color,
    });
    page.drawText(`PDFCrop — ${label}`, {
      x: margin + 28,
      y: H - margin - 56,
      size: 28,
      font,
      color: rgb(1, 1, 1),
    });
  }

  const bytes = await doc.save();
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, bytes);
  console.log(`Wrote ${OUT} (${PAGES.length} pages, ${bytes.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
