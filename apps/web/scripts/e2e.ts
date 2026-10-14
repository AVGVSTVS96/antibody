/**
 * Headless end-to-end check of the built site: every route renders for a few bills (including a vehicle bill), the
 * old `?view=` links redirect, search finds bills and sections, the receipt drawer opens on a source chip, walks what
 * it rests on, closes on ESC and the back button and hands focus back, nothing overflows at 1440, 768 and 390, and a
 * sample of the source URLs the claims cite still answers.
 * `bun apps/web/scripts/e2e.ts <base url>` (default http://localhost:4870, a `vite preview` of apps/web/dist).
 */
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Bundle, BundleIndex, Claim } from "@antibody/core";
import { chromium, type Page } from "playwright-core";

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
  await page.waitForFunction(
    () => document.querySelector("main h1") && !document.querySelector("main [role=status]"),
    null,
    {
      timeout: 30000,
    },
  );
  return { page, errors };
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

async function layoutShift(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let total = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[])
            if (!e.hadRecentInput) total += e.value;
        }).observe({ type: "layout-shift", buffered: true });
        setTimeout(() => resolve(total), 300);
      }),
  );
}

{
  const { page, errors } = await open("/");
  check((await page.title()).toLowerCase().includes("antibody"), `land tab title: ${await page.title()}`);
  await page.locator(".search input").first().fill("GENIUS");
  await page.waitForSelector(".results a[href='/bill/119-s-1582']", { timeout: 10000 }).catch(() => {});
  check(
    (await page.locator(".results a[href='/bill/119-s-1582']").count()) > 0,
    "search 'GENIUS' finds the GENIUS bill",
  );
  await page.locator(".search input").first().fill("H.R. 1");
  await page.waitForTimeout(200);
  check((await page.locator(".results a[href='/bill/119-hr-1']").count()) > 0, "search 'H.R. 1' finds H.R.1");
  check(errors.length === 0, `land has no console errors ${errors.join(" | ")}`);
  await page.close();
}

{
  const { page } = await open("/");
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.click("header button[aria-label^='Switch to']");
  await page
    .waitForFunction((was) => getComputedStyle(document.body).backgroundColor !== was, before, { timeout: 3000 })
    .catch(() => {});
  const after = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(before !== after, `theme button changes the page background (${before} -> ${after})`);
  await page.close();
}

for (const [path, want, label] of [
  ["/nowhere", "/nowhere", "unknown path shows the not-found page"],
  ["/bill/nope", "/bill/nope", "unknown bill shows the not-found page"],
  ["/bill/119-s-1582/story/9", "/bill/119-s-1582/story/9", "unknown chapter shows the not-found page"],
] as const) {
  const { page } = await open(path);
  check(
    page.url().endsWith(want) &&
      (await page.locator("main h1").innerText()).length > 0 &&
      (await page.getByText("NOT FOUND").count()) > 0,
    label,
  );
  await page.close();
}

const ids = index.bills.map((b) => b.id);
const vehicle = index.bills.find((b) => b.stats?.vehicle)?.id;
const sample = [...new Set(["119-s-1582", ids.find((i) => i === "117-hr-5376") ?? ids[1], vehicle])].filter(
  Boolean,
) as string[];

const slugOf = (b: Bundle, sec: Bundle["sections"][number]) =>
  b.sections.filter((s) => s.num === sec.num).length > 1 ? sec.id : sec.num;

for (const id of sample) {
  const bundle = (await Bun.file(join(bundlesDir, `${id}.json`)).json()) as Bundle;
  const claims = (await Bun.file(join(bundlesDir, `${id}.claims.json`)).json()) as Record<string, Claim>;
  const texts = new Set(Object.values(claims).map((c) => c.text));
  const section = bundle.sections.find((s) => s.inFinal);
  const member = bundle.nodes.find((n) => n.kind === "member");
  const routes = [
    [`/bill/${id}`, "xray"],
    [`/bill/${id}/story`, "story"],
    [`/bill/${id}/story/3`, "story 3"],
    ...(section ? [[`/bill/${id}/section/${encodeURIComponent(slugOf(bundle, section))}`, "section"]] : []),
    ...(member ? [[`/bill/${id}/member/${member.id.slice(7)}`, "member"]] : []),
  ] as [string, string][];

  for (const [path, name] of routes) {
    const { page, errors } = await open(path);
    check((await page.title()).length > 12, `${id} ${name}: tab title "${await page.title()}"`);
    if (name === "xray") check((await layoutShift(page)) <= 0.1, `${id} layout shift <= 0.1`);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(150);
      const over = await overflow(page);
      check(over <= 0, `${id} ${name} at ${width}: no horizontal overflow (${over}px)`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page
      .waitForFunction(() => !document.querySelector("a.src.ghost, span.src.ghost"), null, { timeout: 60000 })
      .catch(() => {});
    const hrefs = await page.$$eval("a.src[href]", (as) => as.map((a) => (a as HTMLAnchorElement).href));
    const bad = hrefs.filter((h) => !/^https:\/\/[^/]+\/./.test(h));
    check(hrefs.length > 0 && bad.length === 0, `${id} ${name}: ${hrefs.length} source chips, ${bad.length} malformed`);
    check(errors.length === 0, `${id} ${name}: no console errors ${errors.slice(0, 2).join(" | ")}`);
    await page.close();
  }

  {
    const { page } = await open(`/bill/${id}/story`);
    await page.waitForSelector("a.src:not(.ghost)", { timeout: 60000 });
    const chip = page.locator("a.src:not(.ghost)").first();
    const href = await chip.getAttribute("href");
    await chip.focus();
    await chip.click();
    await page.waitForSelector("[role=dialog] #rcpt-claim");
    const heading = () => page.locator("#rcpt-claim").innerText();
    check(texts.has(await heading()), `${id} receipt states a claim that is in the bundle`);
    check(
      (await page.locator("[role=dialog] a.btn.go").getAttribute("href")) === href,
      `${id} receipt opens the chip's record`,
    );
    check(
      await page.evaluate(() => !!document.querySelector("[role=dialog]")?.contains(document.activeElement)),
      `${id} focus moves into the receipt`,
    );
    check(
      await page.evaluate(() => document.getElementById("root")?.hasAttribute("inert") ?? false),
      `${id} page behind the receipt is inert`,
    );

    let walked = 0;
    for (let depth = 0; depth < 4; depth++) {
      const rest = page.locator(".rcpt-rests li button").first();
      if (!(await rest.count())) break;
      const from = await heading();
      await rest.click();
      await page.waitForFunction((t) => document.querySelector("#rcpt-claim")?.textContent !== t, from);
      walked++;
      if (!texts.has(await heading())) check(false, `${id} a rests-on record opens its own receipt`);
    }
    if (walked) {
      check(true, `${id} rests-on records open their own receipts (${walked} deep)`);
      for (let i = 0; i < walked; i++) await page.click(".rcpt-back");
    }

    const nav = page.locator(".rcpt-nav");
    if (await nav.count()) {
      const first = await heading();
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(100);
      check((await heading()) !== first, `${id} arrow keys walk to the next mark`);
    }

    await page.keyboard.press("Escape");
    await page.waitForSelector("[role=dialog]", { state: "detached", timeout: 3000 });
    check(true, `${id} ESC closes the receipt`);
    check(await chip.evaluate((el) => el === document.activeElement), `${id} focus returns to the chip`);

    await chip.click();
    await page.waitForSelector("[role=dialog]");
    await page.goBack();
    await page.waitForSelector("[role=dialog]", { state: "detached", timeout: 3000 });
    check(page.url().includes(`/bill/${id}/story`), `${id} the back button closes the receipt and stays on the page`);

    await page.setViewportSize({ width: 390, height: 844 });
    await chip.click();
    await page.waitForSelector("[role=dialog]");
    await page.waitForTimeout(450);
    const box = await page.locator("[role=dialog]").boundingBox();
    check(
      !!box && box.x === 0 && box.width > 360 && Math.abs(box.y + box.height - 844) < 2,
      `${id} the receipt is a bottom sheet on a phone`,
    );
    await page.close();
  }
}

/** The x-ray's own behavior: the head's baseline toggle, filters, tape and chart links, keys, hash links, lazy articles, CSV. */
async function xray(id: string) {
  const bundle = (await Bun.file(join(bundlesDir, `${id}.json`)).json()) as Bundle;
  const finals = bundle.sections.filter((s) => s.inFinal);
  const quiet = finals.filter((s) => s.score?.label === "buried").length;
  const slug = (sec: Bundle["sections"][number]) =>
    bundle.sections.filter((s) => s.num === sec.num).length > 1 ? sec.id : sec.num;
  const { page, errors } = await open(`/bill/${id}`);
  const tapeBottom = () => page.evaluate(() => document.querySelector(".xray > .tape")!.getBoundingClientRect().bottom);
  const openRows = () => page.locator(".x-row[data-open]");
  const listed = async () =>
    +(
      (await page.locator(".x-list-head").first().locator("span").innerText())
        .match(/OF ([\d,]+)/)?.[1]
        ?.replace(",", "") ?? -1
    );

  const pressed = await page.locator(".x-filters [aria-pressed=true]").getAttribute("data-filter");
  check(
    pressed === (quiet ? "quiet" : "all"),
    `${id} x-ray opens on ${quiet ? "the quiet-and-costly" : "all"} sections`,
  );
  for (const f of ["all", "loud", "quiet", "late", "lobbied"]) {
    const button = page.locator(`.x-filters [data-filter=${f}]`);
    if (await button.isDisabled()) continue;
    await button.click();
    const n = +(await button.locator("b").innerText()).replace(",", "");
    check((await listed()) === n, `${id} filter ${f}: the list holds the ${n} the button counts`);
  }
  await page.locator(".x-filters [data-filter=all]").click();
  check((await listed()) === finals.length, `${id} all sections: ${finals.length} listed`);
  const rowsDrawn = await page.locator(".x-row").count();
  check(rowsDrawn <= 40, `${id} the list pages: ${rowsDrawn} rows drawn of ${finals.length}`);

  const chart = await page.locator(".x-chart svg").count();
  const hasCost = finals.some((s) => s.dollars.length > 0 && s.dollars.some((d) => d.baseline === "current-law"));
  check(chart === 1, `${id} the gap chart is drawn`);
  check(
    (await page.getByText("NO COST AXIS").count()) === (hasCost ? 0 : 1),
    `${id} says why when the chart has no cost axis`,
  );

  const fig = page.locator(".x-cost-fig strong");
  if (await fig.count()) {
    const toggles = page.locator(".x-toggle button:not(:disabled)");
    if ((await toggles.count()) > 1) {
      const before = await fig.innerText();
      await toggles.nth(1).click();
      check(
        (await fig.innerText()) !== before,
        `${id} the baseline toggle changes the whole-bill figure (${before} -> ${await fig.innerText()})`,
      );
      const labels = await toggles.allInnerTexts();
      check(
        bundle.dollars.estimates.some((e) => labels[1]!.toLowerCase() === e.baselineLabel.toLowerCase()),
        `${id} the toggle names the baseline as the bundle does`,
      );
      await toggles.nth(0).click();
    }
  }

  const stage = page.locator(".xray > .tape .tape-stage");
  const box = (await stage.boundingBox())!;
  await page.evaluate(() => scrollTo(0, 0));
  await stage.click({ position: { x: box.width * 0.6, y: box.height / 2 } });
  await page
    .waitForFunction(
      () => {
        const row = document.querySelector(".x-row[data-open]")?.getBoundingClientRect().top ?? 1e9;
        return Math.abs(row - (document.querySelector(".xray > .tape")!.getBoundingClientRect().bottom + 12)) < 3;
      },
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  check((await openRows().count()) === 1, `${id} a tape click opens that section's row`);
  const rowTop = await openRows()
    .first()
    .evaluate((el) => el.getBoundingClientRect().top);
  const bottom = await tapeBottom();
  check(
    rowTop >= bottom - 2 && rowTop < bottom + 80,
    `${id} the tape click scrolls the row just under the pinned tape (${Math.round(rowTop)} vs ${Math.round(bottom)})`,
  );
  check((await page.locator(".xray > .tape .tape-current").count()) > 0, `${id} the tape marks the row being read`);

  const second = await openRows().first().getAttribute("id");
  await page.keyboard.press("j");
  await page.waitForTimeout(900);
  const afterJ = await openRows().first().getAttribute("id");
  check(!!afterJ && afterJ !== second, `${id} J opens the next section (${second} -> ${afterJ})`);
  await page.keyboard.press("k");
  await page.waitForTimeout(900);
  check((await openRows().first().getAttribute("id")) === second, `${id} K goes back`);
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => location.pathname.includes("/section/"), null, { timeout: 5000 }).catch(() => {});
  check(
    page.url().includes(`/bill/${id}/section/`),
    `${id} Enter opens the section's money page (${new URL(page.url()).pathname})`,
  );
  await page.goBack();
  await page.waitForSelector(".x-row");

  const first = finals.find((s) => s.attention && s.attention.hits > 0 && s.inFinal)!;
  await page.goto(`${base}/bill/${id}#section-${encodeURIComponent(slug(first))}`);
  await page.waitForSelector(".x-row[data-open]", { timeout: 30000 });
  await page.waitForTimeout(900);
  check(
    (await openRows().first().getAttribute("id")) === `section-${slug(first)}`,
    `${id} a #section-<slug> link opens and scrolls to that row`,
  );
  const reading = await page
    .locator(".xray > .tape .tape-current-label")
    .innerText()
    .catch(() => "");
  check(reading.includes(`§${first.num}`), `${id} the tape marks it "${reading}"`);

  const other = finals.find((s) => s.id !== first.id && s.num !== first.num)!;
  await page.evaluate(
    (h) => {
      history.pushState(null, "", h);
      dispatchEvent(new PopStateEvent("popstate"));
    },
    `#section-${encodeURIComponent(slug(other))}`,
  );
  await page
    .waitForFunction((want) => document.querySelector(".x-row[data-open]")?.id === want, `section-${slug(other)}`, {
      timeout: 8000,
    })
    .catch(() => {});
  check(
    (await openRows().first().getAttribute("id")) === `section-${slug(other)}`,
    `${id} a hash link followed inside the page opens that row too`,
  );
  await page.goto(`${base}/bill/${id}#section-${encodeURIComponent(slug(first))}`);
  await page.waitForSelector(".x-row[data-open]", { timeout: 30000 });

  const requests: string[] = [];
  page.on("request", (r) => r.url().includes(".articles.json") && requests.push(r.url()));
  check(requests.length === 0, `${id} the article list is not fetched until asked for`);
  const show = openRows().first().locator("button.linkbtn");
  await show.click();
  await page.waitForSelector(".x-articles li");
  const items = await page.locator(".x-articles li a.src").count();
  check(items === first.attention!.hits, `${id} the open row lists its ${first.attention!.hits} articles (${items})`);
  check(requests.length === 1, `${id} the articles file loaded once, on request`);
  const news = openRows().first().locator(".x-note", { hasText: "NEWS" }).locator("a.src").first();
  await page.waitForSelector("a.src:not(.ghost)");
  await news.click();
  await page.waitForSelector("[role=dialog] #rcpt-claim");
  check(true, `${id} the news count opens its receipt`);
  await page.keyboard.press("Escape");
  await page.waitForSelector("[role=dialog]", { state: "detached" });

  await page.evaluate(() => document.querySelector(".x-gap")!.scrollIntoView());
  const dot = page.locator(".x-dot-other, .x-dot-loud, .x-dot-quiet").nth(2);
  await dot.hover({ force: true });
  check((await page.locator(".x-tip").count()) === 1, `${id} hovering a dot shows its section`);
  check((await page.locator(".xray > .tape [data-lit]").count()) > 0, `${id} and lifts its mark on the tape`);
  check((await page.locator(".x-dot-lift").count()) === 1, `${id} and grows the dot`);
  await page.mouse.move(2, 2);
  await dot.click({ force: true });
  await page.waitForTimeout(900);
  check((await openRows().count()) === 1, `${id} clicking a dot jumps to that section`);

  const download = page.waitForEvent("download");
  await page.locator(".x-list-foot .btn", { hasText: "CSV" }).click();
  const file = await download;
  const text = await Bun.file((await file.path())!).text();
  const lines = text.trim().split("\n").length - 1;
  check(
    file.suggestedFilename().startsWith(id) && text.startsWith("section,heading") && lines === (await listed()),
    `${id} CSV export: ${file.suggestedFilename()}, ${lines} rows`,
  );

  const more = page.locator(".x-list-foot .btn", { hasText: "LOAD" });
  if (await more.count()) {
    const before = await page.locator(".x-row").count();
    await more.click();
    await page.waitForTimeout(300);
    check((await page.locator(".x-row").count()) > before, `${id} load more adds rows`);
  }
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150);
    check((await overflow(page)) <= 0, `${id} x-ray after use at ${width}: no horizontal overflow`);
  }
  check(errors.length === 0, `${id} x-ray use: no console errors ${errors.slice(0, 2).join(" | ")}`);
  await page.close();
}

for (const id of ["119-hr-1", "119-s-1582", "119-hr-4405", "119-s-1071"]) if (ids.includes(id)) await xray(id);

{
  const id = "119-s-1582";
  const { page } = await open(`/bill/${id}?view=money&focus=member:H000601`);
  await page.waitForFunction(() => location.pathname.includes("/member/"));
  check(
    page.url().endsWith(`/bill/${id}/member/H000601`),
    "old ?view=money&focus=member: link redirects to the member page",
  );
  await page.goto(`${base}/bill/${id}?view=list`);
  await page.waitForFunction(() => location.search === "");
  check(page.url().endsWith(`/bill/${id}`), "old ?view=list link redirects to the x-ray");
  await page.goto(`${base}/bill/S.1582`);
  await page.waitForFunction(() => location.pathname === "/bill/119-s-1582");
  check(true, "a bill written S.1582 redirects to its canonical link");

  const input = page.locator("header .search input");
  await input.fill("19");
  await page.waitForSelector(".results a[href*='/section/']", { timeout: 15000 });
  await input.press("Enter");
  await page.waitForFunction(() => location.pathname.includes("/section/"));
  check(page.url().includes("/section/19"), "search finds a section by number and opens its page");
  await page.close();
}

const phone = await open("/bill/119-s-1582", 390);
await phone.page.click(".top-find");
check((await phone.page.locator("#top-sheet input").count()) === 1, "phone: the bill button opens the search");
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
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(u, {
          headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36" },
          signal: AbortSignal.timeout(30000),
          redirect: "follow",
        });
        await r.body?.cancel();
        if (r.ok) ok++;
        else blocked.push(`${r.status} ${u}`);
        return;
      } catch (e) {
        if (attempt === 2) blocked.push(`ERR ${(e as Error).message} ${u}`);
        else await Bun.sleep(1500);
      }
    }
  }),
);
console.log(`source URL sample: ${ok}/${picked.length} answered 2xx`);
for (const b of blocked) console.log(`  ${b}`);
const hard = blocked.filter((b) => /^(404|410|5\d\d|ERR)/.test(b));
check(hard.length === 0, `no sampled source URL is gone or erroring (${hard.length})`);

console.log(failures.length ? `\n${failures.length} failed` : "\nall e2e checks passed");
process.exit(failures.length ? 1 : 0);
