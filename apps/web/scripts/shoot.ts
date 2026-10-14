/**
 * Screenshots every route in the shapes people use it (desktop and phone, light and dark), the receipt drawer open on
 * a fact and on an inference, and reports horizontal overflow, page errors and the tab title.
 * `bun apps/web/scripts/shoot.ts <base url> <out dir> [only]`
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { chromium, type Page } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:4870";
const out = process.argv[3] ?? "shots";
const only = process.argv[4];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: `${homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

const bill = "/bill/119-s-1582";
const openReceipt = (kind: "fact" | "inference") => async (page: Page) => {
  await page.waitForFunction(() => document.querySelector("a.src"));
  const chips = page.locator(kind === "inference" ? "a.src.inference" : "a.src:not(.inference)");
  await chips.first().click();
  await page.waitForSelector(".rcpt");
  await page.waitForTimeout(450);
};

interface Shot {
  name: string;
  path: string;
  desktop?: boolean;
  phone?: boolean;
  full?: boolean;
  act?: (page: Page) => Promise<void>;
}

const routes: Shot[] = [
  { name: "land", path: "/", desktop: true, phone: true },
  { name: "xray", path: bill, desktop: true, phone: true },
  { name: "story", path: `${bill}/story/2`, desktop: true, phone: true },
  { name: "money", path: `${bill}/section/19`, desktop: true, phone: true },
  { name: "member", path: `${bill}/member/H000601`, desktop: true, phone: true },
  { name: "notfound", path: "/bill/nope", desktop: true, phone: true },
  { name: "receipt-fact", path: bill, desktop: true, phone: true, act: openReceipt("fact") },
  { name: "receipt-inference", path: `${bill}/section/19`, desktop: true, phone: true, act: openReceipt("inference") },
];

for (const s of routes)
  for (const mobile of [false, true])
    for (const theme of ["light", "dark"] as const) {
      const name = `${s.name}-${mobile ? "phone" : "desktop"}-${theme}`;
      if ((mobile ? !s.phone : !s.desktop) || (only && !name.includes(only))) continue;
      const page = await browser.newPage({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        deviceScaleFactor: mobile ? 2 : 1,
        isMobile: mobile,
        hasTouch: mobile,
        colorScheme: theme,
      });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await page.goto(`${base}${s.path}${s.path.includes("?") ? "&" : "?"}theme=${theme}`, {
        waitUntil: "networkidle",
      });
      await page.waitForFunction(
        () => document.querySelector("main h1") && !document.querySelector("main [role=status]"),
        null,
        {
          timeout: 30000,
        },
      );
      await page.evaluate(() => document.fonts.ready);
      await s.act?.(page);
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.screenshot({ path: `${out}/${name}.png`, fullPage: !!s.full });
      console.log(name, JSON.stringify({ overflow, errors, title: await page.title() }));
      await page.close();
    }
await browser.close();
