import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [url, output, widthValue, heightValue, colorScheme = "light"] = process.argv.slice(2);
const width = Number(widthValue);
const height = Number(heightValue);

if (!url || !output || !Number.isFinite(width) || !Number.isFinite(height)) {
  console.error("Usage: capture_screen.mjs <url> <output> <width> <height> [light|dark]");
  process.exit(2);
}

const isMobile = width <= 480;

// Prefer installed Chrome for parity with the Stitch references, but fall back to
// Playwright's bundled Chromium so this still runs on a machine without Chrome.
async function launch() {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

const browser = await launch();

try {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile,
    hasTouch: isMobile,
    colorScheme,
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  // Without this the screenshot can race the webfont swap, which surfaces as
  // random baseline flake rather than as a real diff.
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(250);
  await page.screenshot({ path: output, fullPage: false });
} finally {
  await browser.close();
}
