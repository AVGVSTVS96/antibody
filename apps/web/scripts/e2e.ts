/**
 * Headless end-to-end check of the built site: the index lists the published bills in both party columns, a bill
 * page renders its map, the view toggle works, chips link to real record URLs, and a sample of those URLs answers.
 * `bun apps/web/scripts/e2e.ts <base url>` (default http://localhost:4870, a `vite preview` of apps/web/dist).
 */
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Bundle, BundleIndex } from "@antibody/core";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:4870";
const bundlesDir = join(import.meta.dir, "../public/bundles");
const index = (await Bun.file(join(bundlesDir, "index.json")).json()) as BundleIndex;
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "pass" : "FAIL"}  ${what}`);
  if (!ok) failures.push(what);
};

const browser = await chromium.launch({
  executablePath: `${homedir()}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

async function open(path: string, width = 1440) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${base}${path}`, { waitUntil: "load" });
  await page.waitForSelector(path === "/" ? ".billcard" : ".stage", { timeout: 30000 });
  return { page, errors };
}

{
  const { page, errors } = await open("/");
  check((await page.title()).toLowerCase().includes("antibody"), `index tab title: ${await page.title()}`);
  const links = await page.$$eval("a[href^='/bill/']", (as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
  const published = index.bills.map((b) => `/bill/${b.id}`);
  check(
    published.every((p) => links.includes(p)),
    `index links all ${published.length} published bills (${links.length} bill links on the page)`,
  );
  const parties = new Set(index.bills.map((b) => b.sponsorParty));
  check(parties.has("R") && parties.has("D"), "both parties lead at least one published bill");
  const box = page.locator('input[placeholder*="congress.gov"]');
  await box.fill("GENIUS");
  await page.waitForTimeout(300);
  check((await page.locator("a[href='/bill/119-s-1582']").count()) > 0, "search 'GENIUS' keeps the GENIUS bill");
  check(errors.length === 0, `index has no console errors ${errors.join(" | ")}`);
  await page.close();
}

const ids = index.bills.map((b) => b.id);
const sample = ["119-s-1582", ids.find((i) => i === "117-hr-5376") ?? ids[1]].filter(Boolean) as string[];
for (const id of sample) {
  const { page, errors } = await open(`/bill/${id}`);
  await page.waitForSelector(".sigma canvas", { state: "attached", timeout: 20000 });
  check((await page.title()).length > 12, `${id} tab title: ${await page.title()}`);
  check((await page.locator(".sigma canvas").count()) > 0, `${id} map canvas mounted`);
  for (const view of ["money", "list", "map"]) {
    await page.click(`[data-view="${view}"]`);
    await page.waitForTimeout(1000);
    check(
      (await page.locator(`[data-view="${view}"]`).getAttribute("aria-pressed")) === "true" &&
        page.url().includes(view === "map" ? id : `view=${view}`),
      `${id} toggle -> ${view}`,
    );
    if (view === "list") check((await page.locator("table tbody tr").count()) > 0, `${id} X-ray list has section rows`);
  }
  const hrefs = await page.$$eval("a.src[href]", (as) => as.map((a) => (a as HTMLAnchorElement).href));
  const bad = hrefs.filter((h) => !/^https:\/\/[^/]+\/./.test(h));
  check(hrefs.length > 10 && bad.length === 0, `${id} ${hrefs.length} source chips, ${bad.length} malformed`);
  check(errors.length === 0, `${id} no console errors ${errors.slice(0, 2).join(" | ")}`);
  await page.close();
}

const phone = await open(`/bill/${sample[0]}`, 390);
check(
  (await phone.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0,
  "phone 390: no horizontal overflow",
);
await phone.page.close();
await browser.close();

const urls = new Map<string, string>();
for (const f of readdirSync(bundlesDir).filter((f) => f.endsWith(".claims.json"))) {
  const claims = Object.values((await Bun.file(join(bundlesDir, f)).json()) as Bundle["claims"]);
  const step = Math.max(1, Math.floor(claims.length / 6));
  for (let i = 0; i < claims.length; i += step) urls.set(claims[i]!.sourceUrl, claims[i]!.id);
}
const picked = [...urls.keys()].sort(() => 0.5 - Math.random()).slice(0, 40);
let ok = 0;
const blocked: string[] = [];
await Promise.all(
  picked.map(async (u) => {
    try {
      const r = await fetch(u, {
        headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36" },
        signal: AbortSignal.timeout(30000),
        redirect: "follow",
      });
      await r.body?.cancel();
      if (r.ok) ok++;
      else blocked.push(`${r.status} ${u}`);
    } catch (e) {
      blocked.push(`ERR ${(e as Error).message} ${u}`);
    }
  }),
);
console.log(`source URL sample: ${ok}/${picked.length} answered 2xx`);
for (const b of blocked) console.log(`  ${b}`);
const hard = blocked.filter((b) => /^(404|410|5\d\d|ERR)/.test(b));
check(hard.length === 0, `no sampled source URL is gone or erroring (${hard.length})`);

console.log(failures.length ? `\n${failures.length} failed` : "\nall e2e checks passed");
process.exit(failures.length ? 1 : 0);
