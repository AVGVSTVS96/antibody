import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type BillId, billRef, billstatusUrl } from "@antibody/core";
import { paths } from "@antibody/core/node";

export interface BillTitle {
  type: string;
  title: string;
}

export interface BillStatus {
  id: BillId;
  url: string;
  introduced: string | null;
  titles: BillTitle[];
  /** Public law numbers, e.g. "119-27". */
  laws: string[];
  enactedOn: string | null;
}

const fileName = (id: BillId) => {
  const { congress, type, number } = billRef(id);
  return `BILLSTATUS-${congress}${type}${number}.xml`;
};

/** GovInfo bulk BILLSTATUS: reuses what the bills spike downloaded, else fetches into data/lobbying/billstatus. */
export async function billStatus(id: BillId, signal?: AbortSignal): Promise<BillStatus | null> {
  const name = fileName(id);
  const own = join(paths.raw("lobbying"), "billstatus", name);
  for (const path of [join(paths.raw("bills"), "raw", name), own]) {
    const file = Bun.file(path);
    if (await file.exists()) return parseBillStatus(id, await file.text());
  }
  const res = await fetch(billstatusUrl(id), { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`govinfo ${res.status}: ${billstatusUrl(id)}`);
  const xml = await res.text();
  await mkdir(join(paths.raw("lobbying"), "billstatus"), { recursive: true });
  await Bun.write(own, xml);
  return parseBillStatus(id, xml);
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .trim();

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];

function items(xml: string, block: string): string[] {
  const inner = xml.match(new RegExp(`<${block}>([\\s\\S]*?)</${block}>`))?.[1] ?? "";
  return [...inner.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]!);
}

export function parseBillStatus(id: BillId, xml: string): BillStatus {
  const bill = xml.match(/<bill>([\s\S]*)<\/bill>/)?.[1] ?? xml;
  const titles = items(bill, "titles").map((x) => ({
    type: decode(tag(x, "titleType") ?? ""),
    title: decode(tag(x, "title") ?? ""),
  }));
  const laws = items(bill, "laws")
    .map((x) => tag(x, "number"))
    .filter((n): n is string => !!n);
  const enacted = items(bill, "actions").find((x) => /Became (Public|Private) Law/i.test(tag(x, "text") ?? ""));
  return {
    id,
    url: billstatusUrl(id),
    introduced: tag(bill, "introducedDate") ?? null,
    titles,
    laws,
    enactedOn: enacted ? (tag(enacted, "actionDate") ?? null) : null,
  };
}

const OFFICIAL = /^(A bill|An act|To |A joint resolution|A resolution|A concurrent resolution|Joint resolution)/i;

/** Names the whole bill went by (short, popular and display titles), and titles of portions of it. */
export function billNames(s: BillStatus): { whole: string[]; portions: string[] } {
  const whole = new Set<string>();
  const portions = new Set<string>();
  for (const t of s.titles) {
    if (!t.title || OFFICIAL.test(t.title)) continue;
    if (/portions? of this bill/i.test(t.type)) portions.add(t.title);
    else if (/short title|popular title|display title/i.test(t.type)) whole.add(t.title);
  }
  for (const w of whole) portions.delete(w);
  return { whole: [...whole], portions: [...portions] };
}

export const officialTitles = (s: BillStatus) =>
  s.titles.filter((t) => /official title/i.test(t.type)).map((t) => t.title);
