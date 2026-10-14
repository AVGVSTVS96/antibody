/**
 * The Phase 1 screenshots: index, GENIUS (Republican-led) and the Inflation Reduction Act (Democratic-led), at 1440
 * and 390 wide, dark and light. `bun apps/web/scripts/shots.ts <base url> <out dir>`
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:4870";
const out = process.argv[3] ?? "docs/shots";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: `${homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const pages = [
  ["index", "/"],
  ["genius", "/bill/119-s-1582"],
  ["ira", "/bill/117-hr-5376"],
] as const;
for (const [name, path] of pages)
  for (const [w, h, mobile] of [
    [1440, 900, false],
    [390, 844, true],
  ] as const)
    for (const theme of ["dark", "light"] as const) {
      const page = await browser.newPage({
        viewport: { width: w, height: h },
        deviceScaleFactor: mobile ? 2 : 1,
        isMobile: mobile,
        hasTouch: mobile,
        colorScheme: theme,
      });
      await page.goto(`${base}${path}?theme=${theme}`, { waitUntil: "load" });
      await page.waitForSelector(name === "index" ? ".bcard" : ".stage", { timeout: 30000 });
      if (name !== "index") await page.waitForSelector(".sigma canvas", { state: "attached", timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${out}/${name}-${w}-${theme}.png` });
      await page.close();
    }
await browser.close();
