import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type BillId, billRef, billstatusUrl } from "@antibody/core";
import { paths } from "@antibody/core/node";

export interface BillTitle {
  type: string;
  title: string;
  /** The text version the title comes from ("Engrossed in House"), when CRS says. */
  version: string | null;
}

export interface BillStatus {
  id: BillId;
  url: string;
  introduced: string | null;
  titles: BillTitle[];
  /** Public law numbers, e.g. "119-27". */
  laws: string[];
  enactedOn: string | null;
  /** Text versions with their dates ("Engrossed Amendment Senate", 2022-07-27). */
  versions: { type: string; date: string | null }[];
  policyArea: string | null;
  /** CRS's latest summary as plain text. */
  summary: string | null;
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
    version: tag(x, "billTextVersionName") ?? null,
  }));
  const laws = items(bill, "laws")
    .map((x) => tag(x, "number"))
    .filter((n): n is string => !!n);
  const enacted = items(bill, "actions").find((x) => /Became (Public|Private) Law/i.test(tag(x, "text") ?? ""));
  const summaries = [...bill.matchAll(/<summary>[\s\S]*?<text><!\[CDATA\[([\s\S]*?)\]\]><\/text>/g)];
  const summary = summaries.at(-1)?.[1];
  return {
    id,
    url: billstatusUrl(id),
    introduced: tag(bill, "introducedDate") ?? null,
    titles,
    laws,
    enactedOn: enacted ? (tag(enacted, "actionDate") ?? null) : null,
    versions: items(bill, "textVersions").map((x) => ({
      type: decode(tag(x, "type") ?? ""),
      date: tag(x, "date")?.slice(0, 10) ?? null,
    })),
    policyArea: bill.match(/<policyArea>\s*<name>([^<]*)<\/name>/)?.[1] ?? null,
    summary: summary ? decode(summary.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ")).replace(/\s+/g, " ") : null,
  };
}

const OFFICIAL = /^(A bill|An act|To |A joint resolution|A resolution|A concurrent resolution|Joint resolution)/i;

export interface BillName {
  title: string;
  /** current: what the bill is called at the end; earlier: a title it dropped; portion: a title for part of it. */
  kind: "current" | "earlier" | "portion";
  /** When a filing could first have used it for this bill: the date of the text version that carried it. */
  since: string | null;
}

const PORTION = /portions? of (?:this|a) bill/i;
const CURRENT = /display title|popular title|as enacted|enrolled/i;

/**
 * Names the bill went by. For a law, its display, popular and enacted titles are current and the rest are
 * earlier names (a vehicle like CHIPS began as the Legislative Branch Appropriations Act, 2022). Portion titles
 * count only from the latest dated text version when CRS doesn't say which version carried them.
 */
export function billNames(s: BillStatus): BillName[] {
  const dated = s.versions.filter((v) => v.date).map((v) => v.date!);
  const versionDate = (name: string | null) => s.versions.find((v) => v.type === name)?.date ?? null;
  const latest = dated.sort().at(-1) ?? s.introduced;
  const out = new Map<string, BillName>();
  const rank = { current: 2, earlier: 1, portion: 0 };
  for (const t of s.titles) {
    if (!t.title || OFFICIAL.test(t.title) || !/title/i.test(t.type)) continue;
    const kind: BillName["kind"] = PORTION.test(t.type)
      ? "portion"
      : !s.enactedOn || CURRENT.test(t.type) || /enrolled/i.test(t.version ?? "")
        ? "current"
        : "earlier";
    const since = versionDate(t.version) ?? (kind === "portion" ? latest : s.introduced);
    const prev = out.get(t.title);
    if (!prev || rank[kind] > rank[prev.kind]) out.set(t.title, { title: t.title, kind, since });
    else if (rank[kind] === rank[prev.kind] && since && (!prev.since || since < prev.since)) prev.since = since;
  }
  return [...out.values()];
}

export const officialTitles = (s: BillStatus) =>
  s.titles.filter((t) => /official title/i.test(t.type)).map((t) => t.title);
