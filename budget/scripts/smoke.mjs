import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

/**
 * Loads every screen in preview mode and fails on any page error.
 *
 * `node --check` only parses; it cannot tell you that a handler references a
 * function nobody defines any more. That is exactly how a refactor once removed
 * leaveFamily() and rotateInviteCode() as collateral damage while still passing
 * the syntax check - the buttons only broke when a human clicked them.
 *
 * Usage: node scripts/smoke.mjs [baseUrl]
 */
const base = process.argv[2] || "http://127.0.0.1:5188";
const TODAY = "2026-07-15";

const VIEWS = [
  { name: "setup", url: `${base}/?preview=1&screen=setup&today=${TODAY}` },
  { name: "dashboard", url: `${base}/?preview=1&tab=dashboard&today=${TODAY}` },
  { name: "expenses", url: `${base}/?preview=1&tab=expenses&today=${TODAY}` },
  { name: "insights", url: `${base}/?preview=1&tab=insights&today=${TODAY}` },
  { name: "income", url: `${base}/?preview=1&tab=income&today=${TODAY}` },
  { name: "categories", url: `${base}/?preview=1&tab=categories&today=${TODAY}` },
  { name: "family", url: `${base}/?preview=1&tab=family&today=${TODAY}` },
  { name: "add-expense-modal", url: `${base}/?preview=1&tab=dashboard&modal=expense&today=${TODAY}` }
];

// Buttons safe to click: no confirm(), no network, no destructive effect.
const SAFE_CLICKS = [
  "[data-action='replay-tour']",
  "[data-tab]",
  "[data-insight-tab]",
  "[data-modal]"
];

const failures = [];

async function checkView(browser, view, viewport, label) {
  const page = await browser.newPage({ viewport, isMobile: viewport.width <= 480, hasTouch: viewport.width <= 480 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon")) errors.push(`console: ${m.text()}`);
  });

  await page.goto(view.url, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(200);

  // Rendered something?
  const rendered = await page.evaluate(() => document.getElementById("app")?.children.length > 0);
  if (!rendered) errors.push("#app is empty");

  // Every wired handler resolves? Clicking is the only way to find out.
  for (const selector of SAFE_CLICKS) {
    const elements = await page.$$(selector);
    for (const el of elements.slice(0, 4)) {
      try {
        await el.click({ timeout: 1000 });
        await page.waitForTimeout(80);
      } catch {
        /* not visible at this breakpoint; fine */
      }
    }
  }
  await page.waitForTimeout(200);

  if (errors.length) failures.push(`[${label}/${view.name}]\n    ${errors.join("\n    ")}`);
  await page.close();
}

const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: "chrome", headless: true }));
try {
  for (const view of VIEWS) {
    await checkView(browser, view, { width: 390, height: 844 }, "mobile");
    await checkView(browser, view, { width: 1180, height: 900 }, "desktop");
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`SMOKE FAILED (${failures.length})\n\n${failures.join("\n\n")}`);
  process.exit(1);
}
console.log(`smoke passed: ${VIEWS.length} views x 2 breakpoints, no page errors`);
