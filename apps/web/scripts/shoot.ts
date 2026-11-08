import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:4870";
const out = process.argv[3] ?? "shots";
const only = process.argv[4];

mkdirSync(out, { recursive: true });

const browser = await chromium.launch();

const bill = "/bill/119-s-1582";

interface Shot {
  name: string;
  path: string;
  w: number;
  h: number;
  theme: "dark" | "light";
  mobile?: boolean;
  full?: boolean;
}

const shots: Shot[] = [
  { name: "index-dark", path: "/", w: 1440, h: 900, theme: "dark", full: true },
  { name: "index-light-phone", path: "/", w: 390, h: 844, theme: "light", mobile: true, full: true },
  { name: "bill-dark", path: bill, w: 1440, h: 900, theme: "dark" },
  { name: "bill-light", path: bill, w: 1440, h: 900, theme: "light" },
  { name: "bill-dark-pinned", path: `${bill}?focus=company:1403161`, w: 1440, h: 900, theme: "dark" },
  { name: "bill-dark-member", path: `${bill}?focus=member:G000583`, w: 1440, h: 900, theme: "dark" },
  { name: "bill-dark-pac", path: `${bill}?map=pac#map`, w: 1440, h: 900, theme: "dark" },
  { name: "bill-dark-list", path: `${bill}?view=list`, w: 1440, h: 900, theme: "dark" },
  { name: "bill-light-list", path: `${bill}?view=list`, w: 1440, h: 900, theme: "light" },
  { name: "bill-dark-full", path: bill, w: 1440, h: 900, theme: "dark", full: true },
  { name: "bill-phone-dark", path: bill, w: 390, h: 844, theme: "dark", mobile: true, full: true },
  { name: "bill-phone-light-list", path: `${bill}?view=list`, w: 390, h: 844, theme: "light", mobile: true },
  { name: "bill-tablet-dark", path: bill, w: 820, h: 1180, theme: "dark" },
];

for (const s of shots) {
  if (only !== undefined && !s.name.includes(only)) {
    continue;
  }

  const mobile = s.mobile ?? false;

  const page = await browser.newPage({
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: s.theme,
  });

  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const t0 = Date.now();
  await page.goto(`${base}${s.path}${s.path.includes("?") ? "&" : "?"}theme=${s.theme}`, { waitUntil: "networkidle" });

  if (s.path.startsWith("/bill")) {
    await page.waitForSelector("#map", { state: "attached", timeout: 15_000 }).catch(() => null);
  }

  await page.evaluate(async () => await document.fonts.ready);
  await page.waitForTimeout(500);
  const ready = Date.now() - t0;
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.screenshot({ path: `${out}/${s.name}.png`, fullPage: s.full ?? false });
  console.log(s.name, JSON.stringify({ ready, overflow, errors, title: await page.title() }));
  await page.close();
}

await browser.close();
