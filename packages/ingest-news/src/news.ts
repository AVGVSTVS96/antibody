import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type BillId, billDisplay, type Row, type StageContext } from "@antibody/core";
import { paths, python, readRows, writeRows } from "@antibody/core/node";
import queries from "../data/queries.json" with { type: "json" };
import { gnews } from "./gnews.ts";
import { type Window as MCWindow, mediacloudKey, type Story, stories } from "./mediacloud.ts";
import { COUNTED, type Outlet, outletFor, SIDES, type Side, sideOf, TRADE_LEGAL } from "./outlets.ts";

/** Articles read in full per side (and for trade/legal), picked by a fixed hash so re-runs pick the same ones. */
export const SAMPLE = { left: 150, center: 150, right: 150, "trade-legal": 60 } as const;
type Stratum = keyof typeof SAMPLE;

const PKG = join(import.meta.dir, "..");
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export const textDir = (bill: BillId) => join(paths.raw("news"), "text", bill);
export const articleText = async (bill: BillId, articleId: string) => {
  const f = Bun.file(join(textDir(bill), `${articleId.split(":")[1]}.txt`));
  return (await f.exists()) ? f.text() : null;
};

interface Found {
  url: string;
  title: string;
  published: string | null;
  outlet: Outlet | null;
  via: Row<"articles">["via"];
  gnews: boolean;
}

/** The query and window: data/queries.json when the bill is listed, else its short title and number from BILLSTATUS. */
export async function searchPlan(bill: BillId): Promise<{ query: string; window: MCWindow }> {
  const listed = (queries.bills as Record<string, { terms: string[]; window?: string[] }>)[bill];
  const [row] = await readRows("bills", bill);
  const versions = await readRows("versions", bill);
  const terms = listed?.terms ?? [
    ...(row?.short_title ? [`"${row.short_title}"`] : []),
    `"${billDisplay(bill).replace(/(\D)(\d)/, "$1 $2")}"`,
  ];
  let window: MCWindow;
  if (listed?.window) window = { start: listed.window[0]!, end: listed.window[1]! };
  else {
    const dates = versions.flatMap((v) => (v.date ? [Date.parse(v.date)] : []));
    const start = row?.introduced_on ? Date.parse(row.introduced_on) : Math.min(...dates);
    const end = row?.law_on ? Date.parse(row.law_on) : Math.max(...dates, start);
    if (!Number.isFinite(start))
      throw new Error(`no introduced date or versions for ${bill}: run the bills stage first`);
    window = { start: iso(start - 7 * DAY), end: iso(Math.min(end + 30 * DAY, Date.now())) };
  }
  return { query: terms.join(" OR "), window };
}

async function fromMediacloud(bill: BillId, query: string, w: MCWindow, ctx: StageContext): Promise<Found[]> {
  const cache = Bun.file(join(paths.raw("news"), "mediacloud", `${bill}.stories.json`));
  let got: Story[];
  if (!ctx.refresh && (await cache.exists()) && (await cache.json()).query === query)
    got = (await cache.json()).stories;
  else {
    const ids = [...COUNTED, ...TRADE_LEGAL].flatMap((o) => (o.mediacloud_id ? [o.mediacloud_id] : []));
    ctx.log(`Media Cloud: ${query} ${w.start}..${w.end} over ${ids.length} outlets (2 calls/min)`);
    got = await stories(query, ids, w, ctx.signal);
    await Bun.write(cache, JSON.stringify({ query, window: w, fetchedAt: new Date().toISOString(), stories: got }));
  }
  return got.map((s) => ({
    url: s.url,
    title: s.title,
    published: s.publish_date?.slice(0, 10) ?? null,
    outlet: outletFor(s.media_url) ?? outletFor(s.url),
    via: "mediacloud",
    gnews: false,
  }));
}

async function fromGnews(query: string, w: MCWindow, ctx: StageContext): Promise<Found[]> {
  ctx.log(`Google News RSS fallback: ${query} ${w.start}..${w.end}`);
  return (await gnews(query, w, ctx.signal)).flatMap((it) => {
    const outlet = outletFor(it.sourceUrl);
    return outlet
      ? [{ url: it.link, title: it.title, published: it.published, outlet, via: "gnews" as const, gnews: true }]
      : [];
  });
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const stratumOf = (o: Outlet | null): Stratum | null =>
  !o ? null : o.group === "trade-legal" ? "trade-legal" : (sideOf(o.group) satisfies Side | null);

/** The same story run by one outlet's regional sites has several URLs; it is one article: outlet + title + day. */
export function dedupeSyndicated<
  T extends { id: string; url: string; title: string; published: string | null; outlet: Outlet | null },
>(items: T[], preferred: Set<string>): T[] {
  const kept = new Map<string, T>();
  for (const it of items) {
    const title = it.title.trim().replace(/\s+/g, " ").toLowerCase();
    const key = title ? [it.outlet?.domain ?? new URL(it.url).hostname, title, it.published].join("|") : it.url;
    const prior = kept.get(key);
    if (!prior || (preferred.has(it.id) && !preferred.has(prior.id))) kept.set(key, it);
  }
  return [...kept.values()];
}

export function sample<T extends { id: string; stratum: Stratum | null }>(items: T[]): T[] {
  const out: T[] = [];
  for (const s of Object.keys(SAMPLE) as Stratum[]) {
    const pool = items.filter((i) => i.stratum === s).sort((a, b) => (hash(a.id) < hash(b.id) ? -1 : 1));
    out.push(...pool.slice(0, SAMPLE[s]));
  }
  return out;
}

export async function collect(ctx: StageContext) {
  const bill = ctx.bill!;
  const { query, window } = await searchPlan(bill);
  let found: Found[] = [];
  if (await mediacloudKey()) {
    try {
      found = await fromMediacloud(bill, query, window, ctx);
    } catch (e) {
      ctx.log(`Media Cloud failed (${(e as Error).message}); falling back to Google News RSS`);
    }
  } else ctx.log("no MEDIACLOUD_API_KEY; falling back to Google News RSS");
  if (!found.length) found = await fromGnews(query, window, ctx);

  const byUrl = new Map<string, Found>();
  for (const f of found) if (!byUrl.has(f.url)) byUrl.set(f.url, f);
  const distinct = [...byUrl.values()].map((f) => ({
    ...f,
    id: `${bill}:${hash(f.url)}`,
    stratum: stratumOf(f.outlet),
  }));
  const dir = textDir(bill);
  await mkdir(dir, { recursive: true });
  const alreadyRead = new Set(
    (
      await Promise.all(
        distinct.map(async (i) => ((await Bun.file(join(dir, `${i.id.split(":")[1]}.txt`)).exists()) ? i.id : "")),
      )
    ).filter(Boolean),
  );
  const items = dedupeSyndicated(distinct, alreadyRead);

  const picked = sample(items);
  const need = [];
  for (const p of picked)
    if (ctx.refresh || !(await Bun.file(join(dir, `${p.id.split(":")[1]}.txt`)).exists())) need.push(p);
  const fetched = new Map<string, { url: string | null; chars: number }>();
  if (need.length) {
    ctx.log(`reading ${need.length} articles (${picked.length - need.length} already read)`);
    const input = join(paths.raw("news"), `${bill}.fetch.json`);
    await Bun.write(input, JSON.stringify(need.map((p) => ({ id: p.id.split(":")[1], url: p.url, gnews: p.gnews }))));
    const out = await python(PKG, "fetch.py", [input, dir], { memoryMax: "2G" });
    for (const line of out.split("\n").filter(Boolean)) {
      const r = JSON.parse(line);
      fetched.set(`${bill}:${r.id}`, { url: r.url, chars: r.chars });
    }
  }

  const sampled = new Set(picked.map((p) => p.id));
  const rows: Row<"articles">[] = [];
  for (const it of items) {
    let chars: number | null = null;
    let url = it.url;
    if (sampled.has(it.id)) {
      const f = fetched.get(it.id);
      if (f?.url) url = f.url;
      const file = Bun.file(join(dir, `${it.id.split(":")[1]}.txt`));
      chars = f ? f.chars : (await file.exists()) ? (await file.text()).length : 0;
    }
    rows.push({
      id: it.id,
      bill_id: bill,
      url,
      outlet_id: it.outlet?.domain ?? null,
      title: it.title,
      published_on: it.published,
      via: it.via,
      text_chars: chars,
      source_url: url,
      source_locator: null,
    });
  }
  await writeRows("articles", bill, rows);
  const per = (s: Stratum) => items.filter((i) => i.stratum === s).length;
  ctx.log(
    `${rows.length} articles via ${items[0]?.via ?? "none"}; ` +
      `${(Object.keys(SAMPLE) as Stratum[]).map((s) => `${s} ${per(s)}`).join(", ")}; read ${picked.length}`,
  );
  return { query, window, sides: SIDES };
}
