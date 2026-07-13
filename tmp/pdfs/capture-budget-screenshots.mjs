import { chromium } from "/Users/yekanth/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const base = "http://127.0.0.1:5199";
const outDir = "/Users/yekanth/Documents/Expense Tracking/tmp/pdfs";

const shots = [
  ["01-login.png", "/"],
  ["02-dashboard.png", "/?preview=1"],
  ["03-add-expense.png", "/?preview=1&tab=expenses&modal=expense"],
  ["04-family.png", "/?preview=1&tab=family"]
];

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true
});

for (const [name, path] of shots) {
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${outDir}/${name}`, fullPage: false });
}

await page.goto(`${base}/?preview=1&tab=family`, { waitUntil: "networkidle" });
await page.evaluate(() => window.scrollTo(0, 760));
await page.waitForTimeout(250);
await page.screenshot({ path: `${outDir}/05-family-invite.png`, fullPage: false });

await browser.close();
