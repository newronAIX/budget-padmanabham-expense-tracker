import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (_) {
  ({ chromium } = require(path.join(
    process.env.HOME || "",
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
  )));
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "promo", "output");
const frameDir = path.join(outDir, "whatsapp-frames");
const outputPath = path.join(outDir, "budget-padmanabham-promo-te-whatsapp-standard.mp4");
const encoderPath = path.join(root, "scripts", "encode_frames_to_mp4.swift");
const port = Number(process.env.PROMO_PORT || 5188);
const baseUrl = `http://127.0.0.1:${port}`;
const fps = Number(process.env.PROMO_FPS || 12);
const duration = Number(process.env.PROMO_DURATION || 120);
const frameCount = Math.round(fps * duration);
const outputWidth = Number(process.env.PROMO_WIDTH || 540);
const outputHeight = Number(process.env.PROMO_HEIGHT || 960);
const bitrate = Number(process.env.PROMO_BITRATE || 850000);

const assets = {
  dashboard: "output/assets/dashboard.png",
  expenses: "output/assets/expenses.png",
  addExpense: "output/assets/addExpense.png",
  family: "output/assets/family.png",
  insights: "output/assets/insights.png",
  income: "output/assets/income.png",
  categories: "output/assets/categories.png"
};

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

async function ensureScreenAssets(browser) {
  const screens = [
    ["dashboard", "/?preview=1&tab=dashboard"],
    ["expenses", "/?preview=1&tab=expenses"],
    ["addExpense", "/?preview=1&tab=dashboard&modal=expense"],
    ["family", "/?preview=1&tab=family"],
    ["insights", "/?preview=1&tab=insights"],
    ["income", "/?preview=1&tab=income"],
    ["categories", "/?preview=1&tab=categories"]
  ];
  const assetsDir = path.join(outDir, "assets");
  await mkdir(assetsDir, { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true
  });
  for (const [name, route] of screens) {
    const output = path.join(assetsDir, `${name}.png`);
    await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(350);
    await page.screenshot({ path: output, fullPage: false });
  }
  await page.close();
}

async function captureFrames(browser) {
  await rm(frameDir, { recursive: true, force: true });
  await mkdir(frameDir, { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 720, height: 1280 },
    deviceScaleFactor: 1
  });
  await page.goto(`${baseUrl}/promo/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.previewPromoFrame === "function");
  await page.evaluate((assetPaths) => window.preparePromoAssets(assetPaths), assets);

  for (let i = 0; i < frameCount; i += 1) {
    const time = i / fps;
    const dataUrl = await page.evaluate((value) => {
      window.drawPromoFrame(value);
      const canvas = document.getElementById("stage");
      return canvas.toDataURL("image/jpeg", 0.82);
    }, time);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    await writeFile(path.join(frameDir, `frame-${String(i).padStart(5, "0")}.jpg`), Buffer.from(base64, "base64"));
    if (i % (fps * 10) === 0) {
      console.log(`Captured ${i}/${frameCount} frames`);
    }
  }
  await page.close();
}

function runSwiftEncoder() {
  return new Promise((resolve, reject) => {
    const moduleCache = path.join(outDir, "swift-module-cache");
    const child = spawn(
      "swift",
      [
        encoderPath,
        frameDir,
        outputPath,
        String(fps),
        String(outputWidth),
        String(outputHeight),
        String(bitrate),
        String(frameCount)
      ],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          CLANG_MODULE_CACHE_PATH: moduleCache
        }
      }
    );
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Swift encoder exited with code ${code}`));
    });
  });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    await ensureScreenAssets(browser);
    await captureFrames(browser);
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  await mkdir(path.join(outDir, "swift-module-cache"), { recursive: true });
  await runSwiftEncoder();
  console.log(`WhatsApp standard MP4 written: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
