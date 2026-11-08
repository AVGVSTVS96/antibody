import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { billDisplay } from "@antibody/core";
import type { BillId, Row, StageContext } from "@antibody/core";
import { paths, python, readRows, writeRows } from "@antibody/core/node";
import { z } from "zod";
import queries from "../data/queries.json" with { type: "json" };
import { gnews } from "./gnews.ts";
import { mediacloudKey, stories, StoryJson } from "./mediacloud.ts";
import type { Window as MCWindow, Story } from "./mediacloud.ts";
import { COUNTED, outletFor, SIDES, sideOf, TRADE_LEGAL } from "./outlets.ts";
import type { Outlet, Side } from "./outlets.ts";

export const SAMPLE = { left: 150, center: 150, right: 150, "trade-legal": 60 } as const;

type Stratum = keyof typeof SAMPLE;

const PKG = join(import.meta.dir, "..");
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export const textDir = (bill: BillId) => join(paths.raw("news"), "text", bill);

export const articleText = async (bill: BillId, articleId: string) => {
  const f = Bun.file(join(textDir(bill), `${articleId.split(":")[1]}.txt`));

  return (await f.exists()) ? await f.text() : null;
};

const QUERIES = z
  .object({
    bills: z.record(
      z.string(),
      z.object({ terms: z.array(z.string()), window: z.tuple([z.string(), z.string()]).optional() }),
    ),
  })
  .parse(queries);

const StoryCache = z.object({ query: z.string(), stories: z.array(StoryJson) });

const FetchResult = z.object({ id: z.string(), url: z.string().nullable(), chars: z.number() });

interface Found {
  url: string;
  title: string;
  published: string | null;
  outlet: Outlet | null;
  via: Row<"articles">["via"];
  gnews: boolean;
}

export function defaultTerms(shortTitle: string | null, display: string): string[] {
  const name = shortTitle?.replace(/\s+of\s+(?:19|20)\d\d$/iu, "").trim() ?? "";
  const number = display.replace(/(\D)(\d)/u, "$1 $2");
  const spaced = number.replaceAll(/\.(Res|Con)\./gu, ". $1.");
  const numbers = name !== "" && spaced === number && Number(/\d+$/u.exec(number)?.[0]) < 100 ? [] : [number, spaced];

  return [...new Set([...(name === "" ? [] : [name]), ...numbers])].map((t) => `"${t}"`);
}

export function termsFor(bill: BillId, shortTitle: string | null): string[] {
  const listed = QUERIES.bills[bill];

  return listed?.terms ?? defaultTerms(shortTitle, billDisplay(bill));
}

export async function searchPlan(bill: BillId): Promise<{ query: string; window: MCWindow }> {
  const listed = QUERIES.bills[bill];
  const [row] = await readRows("bills", bill);
  const versions = await readRows("versions", bill);
  const terms = termsFor(bill, row?.short_title ?? null);
  let window: MCWindow;

  if (listed?.window) {
    const [start, end] = listed.window;
    window = { start, end };
  } else {
    const dates = versions.flatMap((v) => (v.date === null ? [] : [Date.parse(v.date)]));
    const introduced = row?.introduced_on ?? null;
    const law = row?.law_on ?? null;
    const start = introduced === null ? Math.min(...dates) : Date.parse(introduced);
    const end = law === null ? Math.max(...dates, start) : Date.parse(law);

    if (!Number.isFinite(start)) {
      throw new TypeError(`no introduced date or versions for ${bill}: run the bills stage first`);
    }

    window = { start: iso(start - 7 * DAY), end: iso(Math.min(end + 30 * DAY, Date.now())) };
  }

  return { query: terms.join(" OR "), window };
}

async function fromMediacloud(bill: BillId, query: string, w: MCWindow, ctx: StageContext): Promise<Found[]> {
  const cache = Bun.file(join(paths.raw("news"), "mediacloud", `${bill}.stories.json`));
  const cached = !ctx.refresh && (await cache.exists()) ? StoryCache.safeParse(await cache.json()) : null;
  let got: Story[];

  if (cached?.success === true && cached.data.query === query) {
    got = cached.data.stories;
  } else {
    const ids = [...COUNTED, ...TRADE_LEGAL].flatMap((o) =>
      o.mediacloud_id === null || o.mediacloud_id === 0 ? [] : [o.mediacloud_id],
    );

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
  o ? (o.group === "trade-legal" ? "trade-legal" : (sideOf(o.group) satisfies Side | null)) : null;

export function sample<T extends { id: string; stratum: Stratum | null }>(items: T[]): T[] {
  const out: T[] = [];

  for (const [s, size] of Object.entries(SAMPLE)) {
    const pool = items.filter((i) => i.stratum === s).toSorted((a, b) => (hash(a.id) < hash(b.id) ? -1 : 1));
    out.push(...pool.slice(0, size));
  }

  return out;
}

export async function collect(ctx: StageContext) {
  const { bill } = ctx;

  if (bill === null) {
    throw new Error("the news stage needs a bill");
  }

  const { query, window } = await searchPlan(bill);
  let found: Found[] = [];

  const key = await mediacloudKey();

  if (key !== null && key !== "") {
    try {
      found = await fromMediacloud(bill, query, window, ctx);
    } catch (error) {
      ctx.log(
        `Media Cloud failed (${error instanceof Error ? error.message : String(error)}); falling back to Google News RSS`,
      );
    }
  } else {
    ctx.log("no MEDIACLOUD_API_KEY; falling back to Google News RSS");
  }

  if (!found.length) {
    found = await fromGnews(query, window, ctx);
  }

  const byUrl = new Map<string, Found>();

  for (const f of found) {
    if (!byUrl.has(f.url)) {
      byUrl.set(f.url, f);
    }
  }

  const items = [...byUrl.values()].map((f) => ({ ...f, id: `${bill}:${hash(f.url)}`, stratum: stratumOf(f.outlet) }));

  const picked = sample(items);
  const dir = textDir(bill);
  await mkdir(dir, { recursive: true });
  const need = [];

  for (const p of picked) {
    if (ctx.refresh || !(await Bun.file(join(dir, `${p.id.split(":")[1]}.txt`)).exists())) {
      need.push(p);
    }
  }

  const fetched = new Map<string, { url: string | null; chars: number }>();

  if (need.length) {
    ctx.log(`reading ${need.length} articles (${picked.length - need.length} already read)`);
    const input = join(paths.raw("news"), `${bill}.fetch.json`);
    await Bun.write(input, JSON.stringify(need.map((p) => ({ id: p.id.split(":")[1], url: p.url, gnews: p.gnews }))));
    const out = await python(PKG, "fetch.py", [input, dir], { memoryMax: "2G" });

    for (const line of out.split("\n")) {
      if (line !== "") {
        const r = FetchResult.parse(JSON.parse(line));
        fetched.set(`${bill}:${r.id}`, { url: r.url, chars: r.chars });
      }
    }
  }

  const sampled = new Set(picked.map((p) => p.id));
  const rows: Row<"articles">[] = [];

  for (const it of items) {
    let chars: number | null = null;
    let url = it.url;

    if (sampled.has(it.id)) {
      const f = fetched.get(it.id);

      const fetchedUrl = f?.url ?? "";

      if (fetchedUrl !== "") {
        url = fetchedUrl;
      }

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
  const per = (s: string) => items.filter((i) => i.stratum === s).length;
  ctx.log(
    `${rows.length} articles via ${items[0]?.via ?? "none"}; ` +
      `${Object.keys(SAMPLE)
        .map((s) => `${s} ${per(s)}`)
        .join(", ")}; read ${picked.length}`,
  );

  return { query, window, sides: SIDES };
}
