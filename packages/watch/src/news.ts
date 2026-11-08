import { join } from "node:path";
import { COUNTED, countsBySource, outletFor, SIDE_NAMES, SIDES, sideOf, termsFor } from "@antibody/ingest-news";
import type { Side } from "@antibody/ingest-news";
import { z } from "zod";
import type { BillStatus } from "./billstatus.ts";

export interface NewsCount {
  query: string;
  start: string;
  end: string;
  bySide: Record<Side, number>;
  stories: number;
  url: string;
}

const NewsCountJson: z.ZodType<NewsCount> = z.object({
  query: z.string(),
  start: z.string(),
  end: z.string(),
  bySide: z.object({ left: z.number(), center: z.number(), right: z.number() }),
  stories: z.number(),
  url: z.string(),
});

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const mdy = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
const sources = COUNTED.flatMap((o) => (o.mediacloud_id === null || o.mediacloud_id === 0 ? [] : [o.mediacloud_id]));

const outletsOn = (side: Side) =>
  COUNTED.filter((o) => o.mediacloud_id !== null && o.mediacloud_id !== 0 && SIDES[side].some((g) => g === o.group))
    .length;

export function newsWindow(s: BillStatus, today: string) {
  const law = s.actions.find((a) => a.type === "BecameLaw" || /Became (Public|Private) Law/u.test(a.text))?.date;
  const dates = s.actions.map((a) => a.date).toSorted();
  const from = s.introducedOn ?? dates[0] ?? today;
  const last = law ?? dates.at(-1) ?? today;

  return { start: iso(Date.parse(from) - 7 * DAY), end: iso(Math.min(Date.parse(last) + 30 * DAY, Date.parse(today))) };
}

export function weighSides(byOutlet: Record<string, number>) {
  const bySide: Record<Side, number> = { left: 0, center: 0, right: 0 };

  for (const [domain, n] of Object.entries(byOutlet)) {
    const outlet = outletFor(domain);
    const side = outlet ? sideOf(outlet.group) : null;

    if (side !== null) {
      bySide[side] += n;
    }
  }

  const total = SIDE_NAMES.reduce((sum, side) => sum + outletsOn(side), 0);

  const stories = SIDE_NAMES.reduce(
    (sum, side) => sum + (bySide[side] * total) / SIDE_NAMES.length / outletsOn(side),
    0,
  );

  return { bySide, stories: Math.round(stories) };
}

export const mediacloudSearchUrl = (query: string, start: string, end: string) =>
  `https://search.mediacloud.org/search?${new URLSearchParams({ q: query, nq: "", start: mdy(start), end: mdy(end), p: "onlinenews-mediacloud", ss: sources.join(","), cs: "", any: "any" }).toString()}`;

export async function newsCount(s: BillStatus, today: string, cache: string, signal?: AbortSignal): Promise<NewsCount> {
  const query = termsFor(s.id, s.shortTitle).join(" OR ");
  const { start, end } = newsWindow(s, today);
  const file = Bun.file(join(cache, "news", `${s.id}@${end}.json`));

  if (await file.exists()) {
    const hit = NewsCountJson.safeParse(await file.json());

    if (hit.success && hit.data.query === query && hit.data.start === start) {
      return hit.data;
    }
  }

  const counted = weighSides(await countsBySource(query, sources, { start, end }, signal));
  const out: NewsCount = { query, start, end, ...counted, url: mediacloudSearchUrl(query, start, end) };
  await Bun.write(file, JSON.stringify(out));

  return out;
}
