import type { Window } from "./mediacloud.ts";

export interface GnewsItem {
  title: string;
  link: string;
  published: string | null;
  sourceName: string;
  sourceUrl: string;
}

const STEP_DAYS = 2;
const PAUSE_MS = 1500;

const decode = (s: string) =>
  s
    .replaceAll(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .trim();

export function parseRss(xml: string): GnewsItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gu)].map(([, item = ""]) => {
    const tag = (t: string) => decode(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "u").exec(item)?.[1] ?? "");
    const date = tag("pubDate");

    return {
      title: tag("title").replace(/ - [^-]+$/u, ""),
      link: tag("link"),
      published: date === "" ? null : new Date(date).toISOString().slice(0, 10),
      sourceName: tag("source"),
      sourceUrl: decode(/<source url="([^"]+)"/u.exec(item)?.[1] ?? ""),
    };
  });
}

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

export async function gnews(query: string, w: Window, signal?: AbortSignal): Promise<GnewsItem[]> {
  const seen = new Map<string, GnewsItem>();

  for (let day = w.start; day < w.end; day = addDays(day, STEP_DAYS)) {
    const next = addDays(day, STEP_DAYS) < w.end ? addDays(day, STEP_DAYS) : w.end;
    const q = `${query} after:${day} before:${next}`;
    const url = `https://news.google.com/rss/search?${new URLSearchParams({ q, hl: "en-US", gl: "US", ceid: "US:en" }).toString()}`;
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: signal ?? null });

    if (res.ok) {
      for (const it of parseRss(await res.text())) {
        if (!seen.has(it.link)) {
          seen.set(it.link, it);
        }
      }
    }

    await Bun.sleep(PAUSE_MS);
  }

  return [...seen.values()];
}
