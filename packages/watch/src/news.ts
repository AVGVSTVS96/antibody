import { join } from "node:path";
import type { BillId } from "@antibody/core";
import { COUNTED, countsBySource, outletFor, SIDES, type Side, sideOf, termsFor } from "@antibody/ingest-news";
import type { BillStatus } from "./billstatus.ts";

export interface NewsCount {
  query: string;
  start: string;
  end: string;
  /** Stories per side of the counted outlet list (left, center, right). */
  bySide: Record<Side, number>;
  /** Each side weighted equally: a side's stories scaled by its share of the list's outlets. */
  stories: number;
  url: string;
}

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const mdy = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
const sources = COUNTED.flatMap((o) => (o.mediacloud_id ? [o.mediacloud_id] : []));
const outletsOn = (side: Side) =>
  COUNTED.filter((o) => o.mediacloud_id && (SIDES[side] as readonly string[]).includes(o.group)).length;

/** From a week before introduction to 30 days after it became law (or today). */
export function newsWindow(s: BillStatus, today: string): { start: string; end: string } {
  const law = s.actions.find((a) => a.type === "BecameLaw" || /Became (Public|Private) Law/.test(a.text))?.date;
  const from = s.introducedOn ?? s.actions.map((a) => a.date).sort()[0] ?? today;
  const end = law ? iso(Math.min(Date.parse(law) + 30 * DAY, Date.parse(today))) : today;
  return { start: iso(Date.parse(from) - 7 * DAY), end };
}

/** Sums per-outlet counts into sides and weights the sides equally. */
export function weighSides(byOutlet: Record<string, number>): { bySide: Record<Side, number>; stories: number } {
  const bySide: Record<Side, number> = { left: 0, center: 0, right: 0 };
  for (const [domain, n] of Object.entries(byOutlet)) {
    const outlet = outletFor(domain);
    const side = outlet && sideOf(outlet.group);
    if (side) bySide[side] += n;
  }
  const sides = Object.keys(bySide) as Side[];
  const total = sides.reduce((sum, side) => sum + outletsOn(side), 0);
  const stories = sides.reduce((sum, side) => sum + (bySide[side] * total) / sides.length / outletsOn(side), 0);
  return { bySide, stories: Math.round(stories) };
}

export const mediacloudSearchUrl = (query: string, start: string, end: string) =>
  `https://search.mediacloud.org/search?${new URLSearchParams({ q: query, nq: "", start: mdy(start), end: mdy(end), p: "onlinenews-mediacloud", ss: sources.join(","), cs: "", any: "any" })}`;

/**
 * Stories in the counted outlets (the same list the x-ray's attention reads) that name the bill by its short title
 * or number, from Media Cloud. Cached per bill and window end, so a rerun on the same day asks once.
 */
export async function newsCount(s: BillStatus, today: string, cache: string, signal?: AbortSignal): Promise<NewsCount> {
  const query = termsFor(s.id as BillId, s.shortTitle).join(" OR ");
  const { start, end } = newsWindow(s, today);
  const file = Bun.file(join(cache, "news", `${s.id}@${end}.json`));
  if (await file.exists()) {
    const hit = (await file.json()) as NewsCount;
    if (hit.query === query && hit.start === start) return hit;
  }
  const counted = weighSides(await countsBySource(query, sources, { start, end }, signal));
  const out: NewsCount = { query, start, end, ...counted, url: mediacloudSearchUrl(query, start, end) };
  await Bun.write(file, JSON.stringify(out));
  return out;
}
