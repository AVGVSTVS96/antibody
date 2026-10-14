/**
 * The README screenshots: the new site on H.R.1, viewport-sized (never the whole page), at 1440 and 390 wide, light and dark:
 * the landing page, the x-ray, one story chapter, a section's money, a member, and the receipt drawer on a fact and on
 * an inference. Run it against a production build: `vite build && vite preview --port <p>`, then
 * `bun apps/web/scripts/shots.ts http://127.0.0.1:<p> docs/shots [only one shot by name]`.
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { chromium, type Page } from "playwright-core";

const base = process.argv[2] ?? "http://127.0.0.1:4870";
const out = process.argv[3] ?? "docs/shots";
const only = process.argv[4];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: `${homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

const bill = "/bill/119-hr-1";
const openReceipt = (kind: "fact" | "inference") => async (page: Page) => {
  await page.waitForFunction(() => document.querySelector("a.src"));
  const chips = page.locator(kind === "inference" ? "a.src.inference" : "a.src:not(.inference)");
  await chips.first().click();
  await page.waitForSelector(".rcpt");
  await page.waitForTimeout(450);
};

const shots: { name: string; path: string; act?: (page: Page) => Promise<void> }[] = [
  { name: "land", path: "/" },
  { name: "xray", path: bill },
  { name: "story", path: `${bill}/story/1` },
  { name: "money", path: `${bill}/section/70322` },
  { name: "member", path: `${bill}/member/M001136` },
  { name: "receipt-fact", path: bill, act: openReceipt("fact") },
  { name: "receipt-inference", path: bill, act: openReceipt("inference") },
];

for (const { name, path, act } of shots.filter((s) => !only || s.name === only))
  for (const [width, height, mobile] of [
    [1440, 900, false],
    [390, 844, true],
  ] as const)
    for (const theme of ["light", "dark"] as const) {
      const page = await browser.newPage({
        viewport: { width, height },
        deviceScaleFactor: mobile ? 2 : 1,
        isMobile: mobile,
        hasTouch: mobile,
        colorScheme: theme,
      });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
      await page.waitForFunction(
        () => document.querySelector("main h1") && !document.querySelector("main [role=status]"),
        null,
        { timeout: 30000 },
      );
      await page.evaluate(() => document.fonts.ready);
      await act?.(page);
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${out}/${name}-${width}-${theme}.png` });
      console.log(`${name}-${width}-${theme}`, errors.length ? errors : "ok");
      await page.close();
    }
await browser.close();
