import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (error) {
  const bundledPlaywright = path.join(
    process.env.HOME || "",
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
  );
  ({ chromium } = require(bundledPlaywright));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "promo", "output");
const assetsDir = path.join(outDir, "assets");
const videoPath = path.join(outDir, "budget-padmanabham-promo-te.webm");
const whatsappVideoPath = path.join(outDir, "budget-padmanabham-promo-te-whatsapp.mp4");
const rendererPath = path.join(root, "promo", "index.html");
const promoDurationMs = 120000;
const port = Number(process.env.PROMO_PORT || 5188);
const baseUrl = `http://127.0.0.1:${port}`;
const rendererUrl = `${baseUrl}/promo/index.html`;

const screens = [
  ["dashboard", "/?preview=1&tab=dashboard"],
  ["expenses", "/?preview=1&tab=expenses"],
  ["addExpense", "/?preview=1&tab=dashboard&modal=expense"],
  ["family", "/?preview=1&tab=family"],
  ["insights", "/?preview=1&tab=insights"],
  ["income", "/?preview=1&tab=income"],
  ["categories", "/?preview=1&tab=categories"]
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch (_) {
      await wait(150);
    }
  }
  return false;
}

async function startServer() {
  if (await waitForServer(baseUrl, 900)) return null;
  const child = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  const ready = await waitForServer(baseUrl, 10000);
  if (!ready) {
    child.kill();
    throw new Error(`Timed out waiting for ${baseUrl}`);
  }
  return child;
}

async function captureScreens(browser) {
  await mkdir(assetsDir, { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true
  });

  const assets = {};
  for (const [name, route] of screens) {
    const target = `${baseUrl}${route}`;
    const output = path.join(assetsDir, `${name}.png`);
    await page.goto(target, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(450);
    await page.screenshot({ path: output, fullPage: false });
    assets[name] = `output/assets/${name}.png`;
    console.log(`Captured ${name}: ${output}`);
  }
  await page.close();
  return assets;
}

async function renderVideo(browser, assets) {
  const context = await browser.newContext({
    viewport: { width: 720, height: 1280 },
    deviceScaleFactor: 1,
    acceptDownloads: true
  });
  const page = await context.newPage();
  await page.goto(rendererUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.downloadPromoVideo === "function");
  console.log(`Recording promo video. This takes about ${Math.round(promoDurationMs / 1000)} seconds...`);
  const rawPath = path.join(outDir, "budget-padmanabham-promo-raw.mp4");
  const downloadPromise = page.waitForEvent("download", { timeout: 0 });
  const result = await page.evaluate(
    async (assetPaths) =>
      window.downloadPromoVideo(
        {
          assets: assetPaths,
          mimeTypes: ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4"],
          videoBitsPerSecond: 2600000
        },
        "budget-padmanabham-promo-raw.mp4"
      ),
    assets
  );
  const download = await downloadPromise;
  await download.saveAs(rawPath);
  const videoBuffer = await readFile(rawPath);
  await writeFile(whatsappVideoPath, videoBuffer);
  await rm(rawPath, { force: true });
  await context.close();
  console.log(`Video written: ${whatsappVideoPath}`);
  console.log(`MIME type: ${result.type || "video/webm"}, bytes: ${videoBuffer.length}`);
  return result;
}

function patchWebmDuration(buffer, durationMs) {
  const infoId = Buffer.from([0x15, 0x49, 0xa9, 0x66]);
  const durationId = Buffer.from([0x44, 0x89]);
  const infoOffset = buffer.indexOf(infoId);
  if (infoOffset === -1) return buffer;

  const sizeOffset = infoOffset + infoId.length;
  const sizeByte = buffer[sizeOffset];
  const usesOneByteSize = (sizeByte & 0x80) === 0x80 && sizeByte !== 0xff;
  if (!usesOneByteSize) return buffer;

  const infoSize = sizeByte & 0x7f;
  const payloadStart = sizeOffset + 1;
  const payloadEnd = payloadStart + infoSize;
  if (payloadEnd > buffer.length) return buffer;
  if (buffer.subarray(payloadStart, payloadEnd).indexOf(durationId) !== -1) return buffer;

  const durationPayload = Buffer.alloc(8);
  durationPayload.writeDoubleBE(durationMs, 0);
  const durationElement = Buffer.concat([durationId, Buffer.from([0x88]), durationPayload]);
  const nextInfoSize = infoSize + durationElement.length;
  if (nextInfoSize > 0x7e) return buffer;

  const patchedHeader = Buffer.from(buffer.subarray(0, payloadEnd));
  patchedHeader[sizeOffset] = 0x80 | nextInfoSize;
  return Buffer.concat([patchedHeader, durationElement, buffer.subarray(payloadEnd)]);
}

async function main() {
  if (!existsSync(rendererPath)) throw new Error(`Missing renderer: ${rendererPath}`);
  await mkdir(outDir, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const assets = await captureScreens(browser);
    await renderVideo(browser, assets);
  } finally {
    await browser.close();
    if (server) server.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
