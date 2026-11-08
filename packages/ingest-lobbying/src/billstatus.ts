import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { billRef, billstatusUrl } from "@antibody/core";
import type { BillId } from "@antibody/core";
import { paths } from "@antibody/core/node";

export interface BillTitle {
  type: string;
  title: string;
  version: string | null;
}

export interface BillStatus {
  id: BillId;
  url: string;
  introduced: string | null;
  titles: BillTitle[];
  laws: string[];
  enactedOn: string | null;
  versions: { type: string; date: string | null }[];
  policyArea: string | null;
  summary: string | null;
}

const fileName = (id: BillId) => {
  const { congress, type, number } = billRef(id);

  return `BILLSTATUS-${congress}${type}${number}.xml`;
};

export async function billStatus(id: BillId, signal?: AbortSignal): Promise<BillStatus | null> {
  const name = fileName(id);
  const own = join(paths.raw("lobbying"), "billstatus", name);

  for (const path of [join(paths.raw("bills"), "raw", name), own]) {
    const file = Bun.file(path);

    if (await file.exists()) {
      return parseBillStatus(id, await file.text());
    }
  }

  const res = await fetch(billstatusUrl(id), { signal: signal ?? null });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error(`govinfo ${res.status}: ${billstatusUrl(id)}`);
  }

  const xml = await res.text();
  await mkdir(join(paths.raw("lobbying"), "billstatus"), { recursive: true });
  await Bun.write(own, xml);

  return parseBillStatus(id, xml);
}

const decode = (s: string) =>
  s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll(/&apos;|&#39;/gu, "'")
    .trim();

const tag = (xml: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`, "u").exec(xml)?.[1];

function items(xml: string, block: string): string[] {
  const inner = new RegExp(`<${block}>([\\s\\S]*?)</${block}>`, "u").exec(xml)?.[1] ?? "";

  return [...inner.matchAll(/<item>([\s\S]*?)<\/item>/gu)].flatMap((m) => m[1] ?? []);
}

export function parseBillStatus(id: BillId, xml: string): BillStatus {
  const bill = /<bill>([\s\S]*)<\/bill>/u.exec(xml)?.[1] ?? xml;

  const titles = items(bill, "titles").map((x) => ({
    type: decode(tag(x, "titleType") ?? ""),
    title: decode(tag(x, "title") ?? ""),
    version: tag(x, "billTextVersionName") ?? null,
  }));

  const laws = items(bill, "laws").flatMap((x) => {
    const n = tag(x, "number");

    return n === undefined || n === "" ? [] : [n];
  });

  const enacted = items(bill, "actions").find((x) => /Became (Public|Private) Law/iu.test(tag(x, "text") ?? ""));
  const summaries = [...bill.matchAll(/<summary>[\s\S]*?<text><!\[CDATA\[([\s\S]*?)\]\]><\/text>/gu)];
  const summary = summaries.at(-1)?.[1];

  return {
    id,
    url: billstatusUrl(id),
    introduced: tag(bill, "introducedDate") ?? null,
    titles,
    laws,
    enactedOn: enacted !== undefined && enacted !== "" ? (tag(enacted, "actionDate") ?? null) : null,
    versions: items(bill, "textVersions").map((x) => ({
      type: decode(tag(x, "type") ?? ""),
      date: tag(x, "date")?.slice(0, 10) ?? null,
    })),
    policyArea: /<policyArea>\s*<name>([^<]*)<\/name>/u.exec(bill)?.[1] ?? null,
    summary:
      summary !== undefined && summary !== ""
        ? decode(summary.replaceAll(/<[^>]+>/gu, " ").replaceAll("&nbsp;", " ")).replaceAll(/\s+/gu, " ")
        : null,
  };
}

const OFFICIAL =
  /^(A bill|An act|To |A joint resolution|A resolution|A concurrent resolution|Joint resolution|Making)\b/iu;

export interface BillName {
  title: string;
  kind: "current" | "earlier" | "portion";
  since: string | null;
}

const PORTION = /portions? of (?:this|a) bill/iu;
const CURRENT = /display title|popular title|as enacted|enrolled/iu;

export function billNames(s: BillStatus): BillName[] {
  const dated = s.versions
    .map((v) => v.date)
    .filter((d): d is string => d !== null && d !== "" && d <= (s.enactedOn ?? "9999"));

  const versionDate = (name: string | null) => s.versions.find((v) => v.type === name)?.date ?? null;
  const latest = dated.toSorted().at(-1) ?? s.introduced;
  const out = new Map<string, BillName>();
  const rank = { current: 2, earlier: 1, portion: 0 };

  for (const t of s.titles) {
    if (t.title === "" || /official/iu.test(t.type) || OFFICIAL.test(t.title)) {
      continue;
    }

    const kind: BillName["kind"] = PORTION.test(t.type)
      ? "portion"
      : s.enactedOn === null || s.enactedOn === "" || CURRENT.test(t.type) || /enrolled/iu.test(t.version ?? "")
        ? "current"
        : "earlier";

    const since = versionDate(t.version) ?? (kind === "portion" ? latest : s.introduced);
    const prev = out.get(t.title);

    if (!prev || rank[kind] > rank[prev.kind]) {
      out.set(t.title, { title: t.title, kind, since });
    } else if (
      rank[kind] === rank[prev.kind] &&
      since !== null &&
      since !== "" &&
      (prev.since === null || prev.since === "" || since < prev.since)
    ) {
      prev.since = since;
    }
  }

  return [...out.values()];
}

export const officialTitles = (s: BillStatus) =>
  s.titles.filter((t) => /official title/iu.test(t.type)).map((t) => t.title);
