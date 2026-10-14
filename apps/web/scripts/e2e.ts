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

for (const id of ["119-hr-1", "117-hr-5376", "119-s-1582"].filter((i) => ids.includes(i))) {
  const bundle = (await Bun.file(join(bundlesDir, `${id}.json`)).json()) as Bundle;
  const edges = bundle.edges;
  const resolves = new Map<string, string>(
    edges.flatMap((e) => (e.kind === "resolves_to" ? [[e.src, e.dst] as const] : [])),
  );
  const company = (id: string) => {
    let cur = id;
    for (let i = 0; i < 4 && resolves.has(cur); i++) cur = resolves.get(cur)!;
    return cur.startsWith("company:") ? cur : null;
  };
  const traded = edges.filter((e) => e.kind === "traded");
  const eventsOf = new Map<string, number>();
  for (const e of traded) eventsOf.set(e.src, (eventsOf.get(e.src) ?? 0) + e.props.events.length);

  const byCount = new Map<string, number>();
  for (const e of edges)
    if (e.kind === "lobbied" && e.dst.startsWith("section:")) byCount.set(e.dst, (byCount.get(e.dst) ?? 0) + 1);
  const [secNode] = [...byCount].sort((a, b) => b[1] - a[1])[0] ?? [];
  const sec = bundle.sections.find((s) => `section:${s.id}` === secNode);

  if (sec && secNode) {
    const companies = new Set(
      edges
        .flatMap((e) => (e.kind === "lobbied" && e.dst === secNode ? [company(e.src)] : []))
        .filter((c): c is string => !!c),
    );
    const traders = new Set(traded.filter((e) => companies.has(e.dst)).map((e) => e.src));
    const { page, errors } = await open(`/bill/${id}/section/${encodeURIComponent(slugOf(bundle, sec))}`);
    check(
      companies.size === 0 || (await page.locator(".lrow").count()) > 0,
      `${id} money: a row for each client with a listed company`,
    );
    check(
      traders.size === 0 || (await page.locator(".behind-n strong").innerText()) === String(traders.size),
      `${id} money: ${traders.size} members traded the tied stocks, as counted from the bundle`,
    );
    check(
      (await page.locator(".cbox[data-inference]").count()) === (await page.locator(".cbox:not(.none)").count()),
      `${id} money: every matched company is drawn dashed as an inference`,
    );
    check(
      /tie, not\s+proof/i.test(await page.locator(".note").first().innerText()),
      `${id} money: says a tie is not proof`,
    );
    check(
      (await page.locator(".lfloor").innerText()).toLowerCase().includes("floor"),
      `${id} money: the PAC column says it is a floor`,
    );

    const strip = page.locator(".lrow .strip[tabindex='0']").first();
    if (await strip.count()) {
      await strip.focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForSelector(".tcard");
      const hover = await page.locator(".tcard").innerText();
      check(
        /\$[\d,]+/.test(hover),
        `${id} money: the hover card shows the amount range (${hover.split("\n").slice(0, 3).join(" | ")})`,
      );
      check(/spouse|own|joint|dependent/i.test(hover), `${id} money: the hover card shows whose account`);
      await page.keyboard.press("Enter");
      await page.waitForSelector(".tcard[data-pinned]");
      check(
        (await page.locator(".tcard[data-pinned] a.src").count()) > 0,
        `${id} money: the pinned card links its filing`,
      );
      await page.waitForFunction(() => !document.querySelector(".tcard a.src.ghost"));
      await page.locator(".tcard[data-pinned] a.src").first().click();
      await page.waitForSelector("[role=dialog] #rcpt-claim");
      await page.keyboard.press("Escape");
      await page.waitForSelector("[role=dialog]", { state: "detached" });
      check(true, `${id} money: the card's filing opens its receipt`);
    }
    check(
      (await overflow(page)) <= 0 && errors.length === 0,
      `${id} money: no overflow or errors ${errors.slice(0, 2).join(" | ")}`,
    );
    await page.close();

    const phoneMoney = await open(`/bill/${id}/section/${encodeURIComponent(slugOf(bundle, sec))}`, 390);
    const phoneStrip = phoneMoney.page.locator(".lrow .strip[tabindex='0']").first();
    if (await phoneStrip.count()) {
      await phoneStrip.scrollIntoViewIfNeeded();
      const box = (await phoneStrip.boundingBox())!;
      await phoneMoney.page.mouse.click(box.x + box.width * 0.02, box.y + box.height / 2);
      const hit = await phoneMoney.page.waitForSelector(".tcard[data-pinned]", { timeout: 2000 }).catch(() => null);
      if (hit) {
        await phoneMoney.page.waitForTimeout(400);
        const card = (await hit.boundingBox())!;
        check(
          Math.abs(card.y + card.height - 900) < 2 && card.width >= 389,
          `${id} money: a tapped tick opens a bottom sheet on a phone`,
        );
      }
    }
    await phoneMoney.page.close();
  }

  const bare = bundle.sections.find((s) => s.inFinal && !byCount.has(`section:${s.id}`));
  if (bare) {
    const { page } = await open(`/bill/${id}/section/${encodeURIComponent(slugOf(bundle, bare))}`);
    check(
      (await page.locator("h1").innerText()).startsWith("No lobbying client named"),
      `${id} money: a section no client named says so`,
    );
    check(
      (await page.locator(".lrow").count()) === 0 && (await page.getByText("Show the bill-wide view").count()) === 1,
      `${id} money: and offers the bill-wide view`,
    );
    await page.click("button.btn.go");
    await page.waitForSelector(".lrow");
    check(true, `${id} money: the bill-wide view lists the clients that named the bill`);
    await page.close();
  }

  const members = bundle.nodes.filter((n) => n.kind === "member");
  const traders = members
    .filter((n) => (eventsOf.get(n.id) ?? 0) > 0)
    .sort((a, b) => eventsOf.get(b.id)! - eventsOf.get(a.id)!);
  const pick = (party: string, chamber: string) =>
    traders.find((n) => n.kind === "member" && n.props.party === party && n.props.chamber === chamber);
  const chosen = [pick("R", "House"), pick("D", "House"), pick("R", "Senate") ?? pick("D", "Senate")].filter(
    (n) => !!n,
  );
  const heads: string[][] = [];
  for (const n of chosen) {
    if (n.kind !== "member") continue;
    const { page, errors } = await open(`/bill/${id}/member/${n.props.bioguide}`);
    const total = eventsOf.get(n.id)!;
    const context = await page.locator(".member-context").innerText();
    check(
      context.includes(`${total.toLocaleString("en-US")} TRADES`.toLowerCase()) ||
        context.toLowerCase().includes(`list ${total.toLocaleString("en-US")} trades`),
      `${id} member ${n.props.bioguide} (${n.props.party}, ${n.props.chamber}): the page counts ${total} trades as the bundle does`,
    );
    const median = [...eventsOf.values()].sort((a, b) => a - b);
    const mid = median.length >> 1;
    const expect = median.length % 2 ? median[mid]! : (median[mid - 1]! + median[mid]!) / 2;
    check(
      context.toLowerCase().includes(`filed ${expect}.`),
      `${id} member ${n.props.bioguide}: the median member who traded filed ${expect}`,
    );
    check((await page.locator(".votes").count()) === 1, `${id} member ${n.props.bioguide}: the votes card is there`);
    const owners = await page.locator(".trail-who b").allInnerTexts();
    check(
      owners.length === 0 || /account/.test(owners[0]!),
      `${id} member ${n.props.bioguide}: the owner is shown on the trades`,
    );
    const donors = await page.locator(".donors").innerText();
    check(/floor/i.test(donors), `${id} member ${n.props.bioguide}: the PAC donors say they are a floor`);
    const name = (await page.locator("main h1").innerText())
      .split(/[\s,]+/)
      .filter((w) => w.length > 3 && !w.endsWith("."));
    const who = new RegExp(`(${name.join("|")})`, "gi");
    heads.push(
      (await page.locator(".member h2, .member-rule").allInnerTexts())
        .map((t) =>
          t
            .replace(who, "X")
            .replace(/(: \$[\d,.]+[KMB]?)?\.?$/, "")
            .replace(/[\d,.$]+[KMB]?/g, "#"),
        )
        .filter((t) => !/in th(is|ese)/.test(t)),
    );
    check(
      (await overflow(page)) <= 0 && errors.length === 0,
      `${id} member ${n.props.bioguide}: no overflow or errors ${errors.slice(0, 2).join(" | ")}`,
    );
    await page.close();
  }
  if (heads.length > 1)
    check(
      heads.every((h) => h.join("|") === heads[0]!.join("|")),
      `${id} member: the same headings for a Republican, a Democrat and a senator`,
    );
  check(chosen.length > 0, `${id} member: picked traders to check`);
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
