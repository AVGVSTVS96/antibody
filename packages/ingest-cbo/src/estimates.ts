import { billId, billRef } from "@antibody/core";
import type { BillId, BillType } from "@antibody/core";

export interface Listing {
  url: string;
  pubId: string;
  title: string;
  description: string;
  pubDate: string;
  via?: BillId;
}

const BILL_TYPES = new Map<string, BillType>([
  ["HR", "hr"],
  ["S", "s"],
  ["HJRES", "hjres"],
  ["SJRES", "sjres"],
]);

const SAME_TEXT = /identical bill|public law contains the text/iu;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, " ")
    .trim();

export function companions(xml: string, bill: BillId): BillId[] {
  const own = billRef(bill);

  const short = new Set(
    [...xml.matchAll(/<titleType>(?<kind>[^<]*)<\/titleType>\s*<title>(?<title>[^<]*)<\/title>/gu)].flatMap(
      ({ groups }) => {
        const kind = groups?.kind ?? "";

        return /short title/iu.test(kind) && !/portions/iu.test(kind) ? [norm(decode(groups?.title ?? ""))] : [];
      },
    ),
  );

  const related = /<relatedBills>([\s\S]*?)<\/relatedBills>/u.exec(xml)?.[1] ?? "";

  return related.split(/<\/relationshipDetails>\s*<\/item>/u).flatMap((item) => {
    const [head = "", details = ""] = item.split("<relationshipDetails>");
    const tag = (name: string) => decode(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "u").exec(head)?.[1] ?? "");
    const type = BILL_TYPES.get(tag("type"));
    const congress = Number(tag("congress"));
    const relations = [...details.matchAll(/<type>([^<]*)<\/type>/gu)].map((m) => m[1] ?? "");
    const same = relations.some((r) => SAME_TEXT.test(r)) || short.has(norm(tag("title")));

    if (type === undefined || congress !== own.congress || !same) {
      return [];
    }

    const id = billId({ congress, type, number: Number(tag("number")) });

    return id === bill ? [] : [id];
  });
}

export function parseListings(xml: string): Listing[] {
  const block = /<cboCostEstimates>([\s\S]*?)<\/cboCostEstimates>/u.exec(xml)?.[1] ?? "";
  const seen = new Set<string>();

  return [...block.matchAll(/<item>([\s\S]*?)<\/item>/gu)].flatMap(([, item]) => {
    const tag = (name: string) =>
      decode(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "u").exec(item ?? "")?.[1] ?? "");

    const url = tag("url").replace(/^http:/u, "https:");
    const pubId = /cbo\.gov\/publication\/(\d+)/u.exec(url)?.[1];

    if (pubId === undefined || seen.has(pubId)) {
      return [];
    }

    seen.add(pubId);

    return [{ url, pubId, title: tag("title"), description: tag("description"), pubDate: tag("pubDate") }];
  });
}

const ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

function decode(s: string): string {
  return s
    .replaceAll(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1")
    .replaceAll(/&#(\d+);/gu, (_: string, n: string) => String.fromCodePoint(+n))
    .replaceAll(/&#x([0-9a-f]+);/giu, (_: string, n: string) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replaceAll(/&(\w+);/gu, (m: string, e: string) => ENTITIES.get(e) ?? m)
    .replaceAll(/\s+/gu, " ")
    .trim();
}

export function versionCode(description: string, bill: BillId, known: string[] = []): string | null {
  const d = description.toLowerCase();
  const own = billRef(bill).type.startsWith("h") ? "h" : "s";
  let code: string | null = null;

  if (/public law|enacted|signed into law/u.test(d)) {
    code = "enr";
  } else if (d.includes("passed by the house")) {
    code = own === "h" ? "eh" : "eah";
  } else if (d.includes("passed by the senate")) {
    code = own === "s" ? "es" : "eas";
  } else if (/reported by the senate|senate committee/u.test(d) && d.includes("report")) {
    code = "rs";
  } else if (/reported by the house|house committee/u.test(d) && d.includes("report")) {
    code = "rh";
  } else if (d.includes("as introduced")) {
    code = `i${own}`;
  }

  return code !== null && known.length > 0 && !known.includes(code) ? null : code;
}

export interface Baseline {
  baseline: "current-law" | "current-policy";
  label: string;
}

const MONTH =
  /relative to CBO['’]s ((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}) baseline/iu;

export function baselineOf(listing: Listing, pdf: { month: string | null; enforcement: boolean } | null): Baseline {
  const text = `${listing.title} ${listing.description}`;
  const dynamic = /dynamic/iu.test(listing.title) ? ", dynamic estimate" : "";

  if (
    /budget[- ]enforcement baseline|baseline used for budget enforcement|current[- ]policy baseline/iu.test(text) ||
    (pdf?.enforcement === true && !MONTH.test(text))
  ) {
    return { baseline: "current-policy", label: `Senate budget-enforcement baseline (current policy)${dynamic}` };
  }

  const month = MONTH.exec(text)?.[1] ?? pdf?.month;

  return {
    baseline: "current-law",
    label: `${(month ?? "") === "" ? "CBO current-law baseline" : `CBO ${month} baseline (current law)`}${dynamic}`,
  };
}
