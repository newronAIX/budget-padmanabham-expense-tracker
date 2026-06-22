import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [url, output, widthValue, heightValue] = process.argv.slice(2);
const width = Number(widthValue);
const height = Number(heightValue);

if (!url || !output || !Number.isFinite(width) || !Number.isFinite(height)) {
  console.error("Usage: capture_screen.mjs <url> <output> <width> <height>");
  process.exit(2);
}

const isMobile = width <= 480;
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
});

try {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile,
    hasTouch: isMobile,
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(250);
  await page.screenshot({ path: output, fullPage: false });
} finally {
  await browser.close();
}
