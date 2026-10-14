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
import { activeSpan, type Bundle, type BundleIndex, type Claim } from "@antibody/core";
import { chromium, type Page } from "playwright-core";
import { libraryOf } from "../src/land/rules.ts";

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
  const library = libraryOf(index);
  const featured = library[0]!;
  const bundle = (await Bun.file(join(bundlesDir, `${featured.id}.json`)).json()) as Bundle;

  const blocked = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const blockedErrors: string[] = [];
  blocked.on("pageerror", (e) => blockedErrors.push(e.message));
  await blocked.route(/\/bundles\/(?!index\.json)/, (r) => r.abort());
  await blocked.goto(`${base}/`, { waitUntil: "load" });
  await blocked.waitForSelector(".lib-row", { timeout: 30000 });
  check(
    (await blocked.locator(".lib-row .mini").count()) > 0 &&
      (await blocked.locator(".land-hold .mini").count()) === 1 &&
      (await blocked.locator(".stats .stat").count()) === 5,
    "land paints the library, the featured mini tape and the stat row from index.json alone",
  );
  check(blockedErrors.length === 0, `land with no bundles has no page errors ${blockedErrors.join(" | ")}`);
  await blocked.close();

  const { page, errors } = await open("/");
  await page.waitForSelector(".tape-stage", { timeout: 60000 });
  await page.waitForSelector(".exhibit:not([aria-busy=true])", { timeout: 60000 });
  const rowHrefs = () =>
    page.$$eval(".lib-row .lib-name a", (as) => as.map((a) => new URL((a as HTMLAnchorElement).href).pathname));

  check(
    (await rowHrefs())[0] === `/bill/${featured.id}`,
    `the library opens on the featured bill by the rule (${featured.display})`,
  );
  await page.click(".lib-more");
  const hrefs = await rowHrefs();
  check(
    JSON.stringify(hrefs) === JSON.stringify(library.map((b) => `/bill/${b.id}`)),
    `all ${library.length} bills are listed in rule order`,
  );
  const cells = await page.$$eval(".lib-row", (rows) =>
    rows.map((r) => ({
      lobbying: r.querySelector("[data-col=lobbying] b")?.textContent,
      deficit: r.querySelector("[data-col=deficit]")?.textContent ?? "",
      quiet: r.querySelector("[data-col=quiet] b")?.textContent,
    })),
  );
  check(
    library.every((b, i) => {
      const c = cells[i]!;
      const s = b.stats;
      const words = s.deficitMusd == null ? "no CBO total" : s.deficitMusd < 0 ? "cuts" : "adds";
      return (
        c.lobbying === s.lobbyingReports.toLocaleString("en-US") &&
        c.deficit.includes(words) &&
        c.quiet === (s.buriedTest.tested ? String(s.buried) : "—")
      );
    }),
    "every library row shows the index's numbers, with adds / cuts / no CBO total in words",
  );

  const exhibitHref = await page.getAttribute(".exhibit .ex-title a", "href");
  const exhibitSection = bundle.sections.find(
    (s) =>
      `/bill/${featured.id}/section/${encodeURIComponent(s.num)}` === exhibitHref ||
      exhibitHref?.endsWith(encodeURIComponent(s.id)),
  );
  const lobbied = bundle.edges
    .filter((e) => e.kind === "lobbied" && e.dst === `section:${exhibitSection?.id}`)
    .reduce((n, e) => n + (e.kind === "lobbied" ? e.props.reports : 0), 0);
  check(
    !!exhibitSection &&
      exhibitSection.score?.label === "buried" &&
      (await page.locator(".exhibit .stat strong").nth(2).innerText()) === String(lobbied),
    `the exhibit is a quiet and costly section of ${featured.display} and its lobbying count matches the bundle`,
  );
  check((await page.locator(".exhibit a.src:not(.ghost)").count()) > 0, "the exhibit's numbers carry source chips");

  const stage = page.locator(".tape-stage");
  await stage.focus();
  await page.keyboard.press("ArrowDown");
  const quietText = await stage.getAttribute("aria-valuetext");
  check(
    !!quietText?.includes("Quiet and costly"),
    `tape: arrow down lands on a quiet and costly mark (${quietText?.slice(0, 40)})`,
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction((id) => location.pathname === `/bill/${id}`, featured.id);
  check(page.url().includes("#section-"), "tape: Enter opens the bill at that section");
  await page.goBack();
  await page.waitForSelector(".lib-row");

  const row = page.locator(".lib-row").nth(1);
  await row.hover();
  await page.waitForTimeout(250);
  const hover = await row.evaluate((r) => ({
    rule: getComputedStyle(r, "::before").clipPath,
    lift: getComputedStyle(r.querySelector(".lib-tape")!).transform,
  }));
  check(
    hover.rule === "inset(0px)" && hover.lift === "matrix(1, 0, 0, 1, 0, -4)",
    `library row hover: yellow rule in, tape lifts 4px (${hover.rule}, ${hover.lift})`,
  );
  await page.mouse.move(0, 0);
  await page.keyboard.press("Tab");
  await page.locator(".lib-row .lib-name a").first().focus();
  await page.waitForTimeout(250);
  check(
    (await page
      .locator(".lib-row")
      .first()
      .evaluate((r) => getComputedStyle(r, "::before").clipPath)) === "inset(0px)",
    "library row focus shows the same state as hover",
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction((id) => location.pathname === `/bill/${id}`, featured.id);
  check(true, "library row opens its bill from the keyboard");
  await page.goBack();
  await page.waitForSelector(".lib-row");

  await page.locator(".search input").first().fill("GENIUS");
  await page.waitForSelector(".results .sr-tape .mini", { timeout: 10000 });
  check(true, "search results carry each bill's own mini tape");
  check(errors.length === 0, `land has no console errors after interaction ${errors.join(" | ")}`);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    const over = await overflow(page);
    check(over <= 0, `land at ${width}: no horizontal overflow (${over}px)`);
  }
  await page.close();

  const motion = async (reduce: boolean) => {
    const p = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      reducedMotion: reduce ? "reduce" : "no-preference",
    });
    await p.goto(`${base}/`, { waitUntil: "load" });
    await p.waitForSelector(".tape-rise", { timeout: 60000 });
    const name = await p
      .locator(".tape-rise")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
    await p.close();
    return name;
  };
  check((await motion(false)) !== "none", "the tape draws itself in with motion allowed");
  check((await motion(true)) === "none", "the tape appears at once with reduced motion");

  const shift = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await shift.goto(`${base}/`, { waitUntil: "load" });
  await shift.waitForSelector(".tape-stage", { timeout: 60000 });
  await shift.waitForSelector(".exhibit:not([aria-busy=true])");
  check((await layoutShift(shift)) <= 0.1, "land layout shift <= 0.1 while the featured bill loads");
  await shift.close();

  const mobile = await open("/", 390);
  await mobile.page.waitForSelector(".lede-go");
  const story = await mobile.page.getAttribute(".lede-go", "href");
  check(story === `/bill/${featured.id}/story`, "phone: the lede's button opens the featured bill's story");
  check(
    (await mobile.page.locator(".also .card").count()) === Math.min(2, library.length - 1),
    "phone: also on the front page shows the next bills in rule order",
  );
  check(
    (await mobile.page.locator(".just li").count()) === Math.min(5, index.watch.length),
    "phone: just in from Congress lists the watcher's picks",
  );
  await mobile.page.click(".lede-go");
  await mobile.page.waitForFunction(() => location.pathname.endsWith("/story"));
  await mobile.page.close();
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

const claimsOf = async (id: string) =>
  Object.assign(
    {},
    ...(await Promise.all(
      readdirSync(bundlesDir)
        .filter((f) => f.startsWith(`${id}.claims.`))
        .map((f) => Bun.file(join(bundlesDir, f)).json() as Promise<Record<string, Claim>>),
    )),
  ) as Record<string, Claim>;

const slugOf = (b: Bundle, sec: Bundle["sections"][number]) =>
  b.sections.filter((s) => s.num === sec.num).length > 1 ? sec.id : sec.num;

for (const id of sample) {
  const bundle = (await Bun.file(join(bundlesDir, `${id}.json`)).json()) as Bundle;
  const claims = await claimsOf(id);
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
    const touched = Math.min(await page.locator("a.src").count(), 20);
    for (let i = 0; i < touched; i++) await page.locator("a.src").nth(i).hover();
    await page
      .waitForFunction(
        (n) => [...document.querySelectorAll("a.src")].slice(0, n).every((a) => a.hasAttribute("href")),
        touched,
        { timeout: 60000 },
      )
      .catch(() => {});
    const hrefs = await page.$$eval("a.src[href]", (as) => as.map((a) => (a as HTMLAnchorElement).href));
    const bad = hrefs.filter((h) => !/^https:\/\/[^/]+\/./.test(h));
    check(hrefs.length > 0 && bad.length === 0, `${id} ${name}: ${hrefs.length} source chips, ${bad.length} malformed`);
    check(errors.length === 0, `${id} ${name}: no console errors ${errors.slice(0, 2).join(" | ")}`);
    await page.close();
  }

  {
    const { page } = await open(`/bill/${id}/story`);
    const chip = page.locator("a.src").first();
    await chip.waitFor();
    const fetched = () =>
      page.evaluate(
        () => performance.getEntriesByType("resource").filter((e) => /\.claims\.\d+\.json/.test(e.name)).length,
      );
    check((await fetched()) === 0, `${id} no claims are fetched until a chip is touched`);
    await chip.focus();
    await page.waitForFunction(() => document.querySelector("a.src")?.hasAttribute("href"), null, { timeout: 60000 });
    check((await fetched()) > 0, `${id} focusing a chip fetches its claim, and its link to the record appears`);
    const href = await chip.getAttribute("href");
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

{
  const storyBills = ["119-hr-1", "117-hr-5376", "119-s-1582", "119-hr-4405", "117-s-3522"].filter((id) =>
    ids.includes(id),
  );
  const bundleOf = async (id: string) => (await Bun.file(join(bundlesDir, `${id}.json`)).json()) as Bundle;
  const groupCount = (n: number) => `CHAPTER ${n} OF 6`;

  for (const id of storyBills) {
    const b = await bundleOf(id);
    const final = b.sections.filter((s) => s.inFinal);
    const headline = final.filter((s) => s.score?.label === "headline").length;
    const quiet = final.filter((s) => s.score?.label === "buried").length;
    const span = activeSpan(b);
    const traders = new Set(
      b.edges.flatMap((e) =>
        e.kind === "traded" && span && e.props.events.some((ev) => ev.date >= span[0] && ev.date <= span[1])
          ? [e.src]
          : [],
      ),
    );
    for (let n = 1; n <= 6; n++) {
      const { page, errors } = await open(`/bill/${id}/story/${n}`, 390);
      const head = await page.locator(".story-count").innerText();
      check(head.includes(groupCount(n)), `${id} story ${n}: header says ${groupCount(n)}`);
      check(
        /\d:\d\d/.test(await page.locator(".story-count time").innerText()),
        `${id} story ${n}: reading time shown`,
      );
      check((await page.locator(".story-steps li").count()) === 6, `${id} story ${n}: six progress segments`);
      check(
        (await page.locator(".story-steps [data-state=done]").count()) === n - 1 &&
          (await page.locator(".story-steps [aria-current=step]").count()) === 1,
        `${id} story ${n}: ${n - 1} segments done, one current`,
      );
      const h1 = await page.locator("main h1").innerText();
      if (n === 1 && headline)
        check(h1.includes(`${headline} section`), `${id} story 1 headline counts ${headline} loud sections`);
      if (n === 2 && quiet)
        check(h1.includes(`${quiet} section`), `${id} story 2 headline counts ${quiet} quiet sections`);
      if (n === 2)
        check(
          (await page.locator(".ch").getAttribute("data-tone")) === (quiet ? "quiet" : null),
          `${id} story 2: ${quiet ? "yellow" : "plain"} page tone`,
        );
      if (n === 4)
        check(
          h1.replace(/\s/g, "").includes(b.lobbying.reports.toLocaleString("en-US")),
          `${id} story 4 headline is ${b.lobbying.reports} reports`,
        );
      if (n === 6 && traders.size)
        check(h1.startsWith(String(traders.size)), `${id} story 6 headline is ${traders.size} members`);
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(120);
        check((await overflow(page)) <= 0, `${id} story ${n} at ${width}: no horizontal overflow`);
      }
      await page
        .waitForFunction(() => !document.querySelector("a.src.ghost, span.src.ghost"), null, { timeout: 60000 })
        .catch(() => {});
      const gone = await page.locator("span.src.gone").count();
      check(gone === 0, `${id} story ${n}: every chip finds its claim (${gone} without a record)`);
      check(errors.length === 0, `${id} story ${n}: no console errors ${errors.slice(0, 2).join(" | ")}`);
      await page.close();
    }
  }

  const id = "119-hr-1";
  const url = (n?: number) => `/bill/${id}/story${n ? `/${n}` : ""}`;
  const path = (page: Page) => new URL(page.url()).pathname;
  const settle = (page: Page, p: string) =>
    page.waitForFunction((x) => location.pathname === x, p, { timeout: 5000 }).catch(() => {});

  {
    const { page } = await open(url(), 1440);
    check(
      (await page.locator(".story-count").innerText()).includes(groupCount(1)),
      "story without a chapter opens chapter 1",
    );
    await page.keyboard.press("ArrowRight");
    await settle(page, url(2));
    check(path(page) === url(2), "ArrowRight goes to the next chapter");
    await page.keyboard.press("ArrowLeft");
    await settle(page, url(1));
    check(path(page) === url(1), "ArrowLeft goes back");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(150);
    check(path(page) === url(1), "ArrowLeft on chapter 1 stays");
    await page.locator(".story-steps li:nth-child(4) a").click();
    await settle(page, url(4));
    check(path(page) === url(4), "tapping a progress segment jumps to that chapter");
    await page.goto(`${base}${url(6)}`);
    await page.waitForSelector("main h1");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);
    check(path(page) === url(6), "ArrowRight on chapter 6 stays");
    await page.waitForSelector("a.src:not(.ghost)", { timeout: 60000 });
    await page.locator("a.src:not(.ghost)").first().click();
    await page.waitForSelector("[role=dialog]");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(150);
    check(path(page) === url(6), "arrow keys walk the receipt, not the chapters, while it is open");
    await page.keyboard.press("Escape");
    await page.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(`${base}${url(2)}`);
    await page.waitForSelector(".story-head");
    const cdp = await ctx.newCDPSession(page);
    const drag = async (x0: number, y0: number, x1: number, y1: number) => {
      const t = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
        cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
      await t("touchStart", x0, y0);
      for (let i = 1; i <= 6; i++) await t("touchMove", x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * i) / 6);
      await t("touchEnd", x1, y1);
      await page.waitForTimeout(600);
    };
    await drag(300, 500, 80, 510);
    await settle(page, url(3));
    check(path(page) === url(3), "a swipe left goes to the next chapter");
    await drag(80, 500, 300, 510);
    await settle(page, url(2));
    check(path(page) === url(2), "a swipe right goes back");
    await drag(200, 700, 190, 300);
    check(path(page) === url(2), "a vertical swipe scrolls and does not change the chapter");
    await page.goto(`${base}${url(6)}`);
    await page.waitForSelector(".day-chart svg");
    const box = (await page.locator(".day-chart svg").boundingBox())!;
    await page.evaluate((y) => scrollTo(0, y), box.y - 200);
    const at = (await page.locator(".day-chart svg").boundingBox())!;
    await drag(at.x + 60, at.y + 60, at.x + 300, at.y + 62);
    check(path(page) === url(6), "a drag across the day chart reads the chart and does not turn the page");
    await ctx.close();
  }

  for (const scheme of ["light", "dark"] as const) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
    const page = await ctx.newPage();
    await page.goto(`${base}${url(2)}`);
    await page.waitForSelector("main h1");
    await page.waitForTimeout(500);
    const bg = () => page.locator(".story").evaluate((el) => getComputedStyle(el).backgroundColor);
    check((await bg()) === "rgb(255, 232, 31)", `${scheme}: chapter 2 is yellow (${await bg()})`);
    const ink = await page.locator(".ch-lede .lead").evaluate((el) => getComputedStyle(el).color);
    check(ink === "rgb(11, 11, 11)", `${scheme}: chapter 2 text is ink on yellow (${ink})`);
    await page.goto(`${base}${url(1)}`);
    await page.waitForSelector("main h1");
    await page.waitForTimeout(500);
    check((await bg()) !== "rgb(255, 232, 31)", `${scheme}: chapter 1 is not yellow`);
    await ctx.close();
  }

  {
    const { page } = await open(`/bill/117-hr-5376/story/2`, 390);
    const bg = await page.locator(".story").evaluate((el) => getComputedStyle(el).backgroundColor);
    check(bg !== "rgb(255, 232, 31)", "a bill with no quiet section keeps chapter 2 off yellow");
    await page.close();
  }

  for (const motion of ["no-preference", "reduce"] as const) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: motion });
    const page = await ctx.newPage();
    await page.goto(`${base}${url(2)}`);
    await page.waitForSelector(".q-bar");
    const anim = await page
      .locator(".q-bar")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
    check(
      (anim !== "none") === (motion === "no-preference"),
      `bars grow only when motion is welcome (${motion}: ${anim})`,
    );
    const fill = await page
      .locator(".story-steps [data-state=now] a")
      .evaluate((el) => getComputedStyle(el, "::before").animationName);
    check(
      (fill !== "none") === (motion === "no-preference"),
      `the progress fill runs only when motion is welcome (${motion}: ${fill})`,
    );
    await ctx.close();
  }

  {
    const { page } = await open(url(1), 390);
    const first = page.locator(".sq-row").first();
    const shown = Number(await first.locator(".squares b").innerText());
    check((await first.locator(".squares i").count()) === shown, "chapter 1: a row draws one square per article");
    await first.locator(".squares").click();
    check(
      (await first.locator(".sq-open li").count()) <= 3 &&
        (await first.locator(".sq-open li a[href^=http]").count()) > 0,
      "chapter 1: a row opens up to three example articles with real links",
    );
    await first.locator(".sq-open .linkbtn").click();
    await page.waitForFunction((n) => document.querySelectorAll(".sq-open li").length === n, shown, { timeout: 10000 });
    check(true, `chapter 1: show all lists all ${shown} counted articles`);
    await page.locator(".outlet-bar button").first().click();
    check(
      (await page.locator(".squares i[data-dim]").count()) > 0,
      "chapter 1: an outlet segment dims the squares of the other groups",
    );
    await page.locator(".outlet-bar button").first().click();
    check((await page.locator(".squares i[data-dim]").count()) === 0, "chapter 1: tapping again clears the filter");
    await page.close();
  }

  {
    const { page } = await open(url(2), 390);
    const chip = page.locator(".q-row .lda").first();
    await chip.click();
    await page.waitForSelector(".q-open");
    check(true, "chapter 2: an LDA chip opens the filings that name the section");
    await page.close();
  }

  {
    const { page } = await open(url(3), 390);
    const cards = page.locator(".bl-pick");
    if ((await cards.count()) === 2) {
      await cards.nth(1).click();
      await page.waitForFunction(() => document.querySelector(".ch-h1")?.textContent?.includes("cut from"), null, {
        timeout: 3000,
      });
      check(true, "chapter 3: the baseline switch turns the headline to the other baseline");
      check(
        (await cards.count()) === 2 && (await page.locator(".bl").count()) === 2,
        "chapter 3: both baselines stay on screen",
      );
    }
    await page.locator(".move-bar button").first().click();
    check(
      (await page.locator(".move-open li").count()) > 0,
      "chapter 3: pressing a segment lists the sections it holds",
    );
    await page.close();
  }

  {
    const { page } = await open(url(4), 390);
    await page.locator(".phase-bar button").first().click();
    check((await page.locator(".cl-sq i[data-dim]").count()) > 0, "chapter 4: a phase segment recolours the squares");
    await page.locator(".cl-head").first().click();
    await page.waitForSelector("[role=dialog]");
    check(true, "chapter 4: a client row opens its filings in the receipt");
    await page.keyboard.press("Escape");
    await page.close();
  }

  {
    const { page } = await open(url(5), 390);
    const tie = page.locator(".tie").first();
    await tie.locator("summary").click();
    check(
      (await tie.locator(".tie-open li a[href*='/member/']").count()) > 0,
      "chapter 5: a tie opens the members who traded its stock",
    );
    check(
      (await page.locator(".story-head").evaluate((el) => getComputedStyle(el).borderBottomStyle)) === "dashed",
      "chapter 5: the whole chapter is drawn dashed",
    );
    await page.close();
  }

  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await ctx.newPage();
    await page.goto(`${base}${url(6)}`);
    await page.waitForSelector(".day-chart svg");
    const svg = page.locator(".day-chart svg");
    await svg.scrollIntoViewIfNeeded();
    const box = (await svg.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 80);
    check(/trades?/i.test(await page.locator(".day-read").innerText()), "chapter 6: hovering a day reads its trades");
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.move(0, 0);
    check(/trades?/i.test(await page.locator(".day-read").innerText()), "chapter 6: a pressed day stays pinned");
    check((await page.locator(".pin").count()) >= 3, "chapter 6: the votes are pinned on the chart");
    check((await page.locator(".month-bar").count()) >= 24, "chapter 6: the all-months baseline draws every month");
    await page.locator(".lead-rows a").first().click();
    await page.waitForFunction(() => location.pathname.includes("/member/"));
    await page.goBack();
    await page.waitForSelector(".share");
    await page.locator(".share").click();
    await page.waitForTimeout(200);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    check(copied === `${base}${url()}`, `share copies the story link (${copied})`);
    await ctx.close();
  }
}

const phone = await open("/bill/119-s-1582", 390);
await phone.page.click(".top-find");
check((await phone.page.locator("#top-sheet input").count()) === 1, "phone: the bill button opens the search");
await phone.page.close();
await browser.close();

const urls = new Map<string, string>();
for (const f of readdirSync(bundlesDir).filter((f) => /\.claims\.\d+\.json$/.test(f))) {
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
