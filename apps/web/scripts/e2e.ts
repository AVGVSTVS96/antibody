import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Bundle, BundleIndex } from "@antibody/core";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:4870";
const bundlesDir = join(import.meta.dir, "../public/bundles");
const index = BundleIndex.parse(await Bun.file(join(bundlesDir, "index.json")).json());
const failures: string[] = [];

const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "pass" : "FAIL"}  ${what}`);

  if (!ok) {
    failures.push(what);
  }
};

const browser = await chromium.launch();

async function open(path: string, width = 1440) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${base}${path}`, { waitUntil: "load" });
  await page.waitForSelector(path === "/" ? ".lawrow" : "#map", { state: "attached", timeout: 30_000 });

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
  const box = page.locator(".bigfind input");
  await box.fill("GENIUS");
  await page.waitForTimeout(300);
  check((await page.locator("a[href='/bill/119-s-1582']").count()) > 0, "search 'GENIUS' keeps the GENIUS bill");
  await box.fill("");

  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(over <= 0, `index at ${width}: no horizontal overflow (${over}px)`);
  }

  check(errors.length === 0, `index has no console errors ${errors.join(" | ")}`);
  await page.close();
}

const ids = index.bills.map((b) => b.id);
const sample = ["119-s-1582", ids.find((i) => i === "117-hr-5376") ?? ids[1]].filter((i) => i !== undefined);

for (const id of ids) {
  const { page, errors } = await open(`/bill/${id}`);
  check((await page.title()).length > 12, `${id} tab title: ${await page.title()}`);
  check((await page.locator(".bhero h1").count()) === 1, `${id} renders its heading`);

  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(over <= 0, `${id} at ${width}: no horizontal overflow (${over}px)`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });

  if (sample.includes(id)) {
    const shift = await page.evaluate(
      async () =>
        // oxlint-disable-next-line promise/avoid-new -- runs inside the page, where setTimeout is the only timer
        await new Promise<number>((resolve) => {
          let total = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              if ("value" in e && "hadRecentInput" in e && e.hadRecentInput !== true) {
                total += Number(e.value);
              }
            }
          }).observe({ type: "layout-shift", buffered: true });
          setTimeout(() => {
            resolve(total);
          }, 300);
        }),
    );

    check(shift <= 0.1, `${id} layout shift ${shift.toFixed(3)} <= 0.1`);
    await page.goto(`${base}/bill/${id}?view=list`, { waitUntil: "load" });
    await page.waitForSelector("table tbody tr", { timeout: 20_000 });
    check((await page.locator("table tbody tr").count()) > 0, `${id} section list has rows`);
    await page.goto(`${base}/bill/${id}`, { waitUntil: "load" });
    await page.waitForSelector("a.src[href]", { timeout: 20_000 });
    const hrefs = await page.$$eval("a.src[href]", (as: HTMLAnchorElement[]) => as.map((a) => a.href));
    const bad = hrefs.filter((h) => !/^https:\/\/[^/]+\/./u.test(h));
    check(hrefs.length > 5 && bad.length === 0, `${id} ${hrefs.length} source links, ${bad.length} malformed`);
  }

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

for (const name of readdirSync(bundlesDir).filter((f) => f.endsWith(".claims.json"))) {
  const claims = Object.values(Bundle.shape.claims.parse(await Bun.file(join(bundlesDir, name)).json()));
  const step = Math.max(1, Math.floor(claims.length / 6));

  for (const c of claims.filter((_, i) => i % step === 0)) {
    urls.set(c.sourceUrl, c.id);
  }
}

const picked = [...urls.keys()].toSorted(() => 0.5 - Math.random()).slice(0, 40);
let ok = 0;
const blocked: string[] = [];

await Promise.all(
  picked.map(async (u) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(u, {
          headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36" },
          signal: AbortSignal.timeout(30_000),
          redirect: "follow",
        });

        await r.body?.cancel();

        if (r.ok) {
          ok++;
        } else {
          blocked.push(`${r.status} ${u}`);
        }

        return;
      } catch (error) {
        if (attempt === 2) {
          blocked.push(`ERR ${error instanceof Error ? error.message : String(error)} ${u}`);
        } else {
          await Bun.sleep(1500);
        }
      }
    }
  }),
);

console.log(`source URL sample: ${ok}/${picked.length} answered 2xx`);

for (const b of blocked) {
  console.log(`  ${b}`);
}

const hard = blocked.filter((b) => /^(404|410|5\d\d|ERR)/u.test(b));

check(hard.length === 0, `no sampled source URL is gone or erroring (${hard.length})`);

console.log(failures.length ? `\n${failures.length} failed` : "\nall e2e checks passed");

process.exit(failures.length ? 1 : 0);
