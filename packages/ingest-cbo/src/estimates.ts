import { type BillId, billRef } from "@antibody/core";

/** One `<cboCostEstimates><item>` from BILLSTATUS: the publication and the bill version CBO says it scored. */
export interface Listing {
  url: string;
  pubId: string;
  title: string;
  description: string;
  pubDate: string;
  /** Set when the estimate is listed on a bill that carried this bill's text, and names that bill. */
  via?: BillId;
}

const BILL_TYPES: Record<string, string> = { HR: "hr", S: "s", HJRES: "hjres", SJRES: "sjres" };
const SAME_TEXT = /identical bill|public law contains the text/i;
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Bills BILLSTATUS says carried the same text as this one: those it calls an identical bill or a public law that
 * contains its text, and related bills of the same Congress that bear this bill's own short title (a House vehicle
 * whose text the Senate replaced with a Senate bill's). CBO often scores only the other bill.
 */
export function companions(xml: string, bill: BillId): BillId[] {
  const own = billRef(bill);
  const short = new Set(
    [...xml.matchAll(/<titleType>([^<]*)<\/titleType>\s*<title>([^<]*)<\/title>/g)]
      .filter(([, kind]) => /short title/i.test(kind!) && !/portions/i.test(kind!))
      .map(([, , title]) => norm(decode(title!))),
  );
  const related = xml.match(/<relatedBills>([\s\S]*?)<\/relatedBills>/)?.[1] ?? "";
  return related.split(/<\/relationshipDetails>\s*<\/item>/).flatMap((item) => {
    const [head = "", details = ""] = item.split("<relationshipDetails>");
    const tag = (name: string) => decode(head.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "");
    const type = BILL_TYPES[tag("type")];
    const id = `${tag("congress")}-${type}-${tag("number")}` as BillId;
    const relations = [...details.matchAll(/<type>([^<]*)<\/type>/g)].map((m) => m[1]!);
    const same = relations.some((r) => SAME_TEXT.test(r)) || short.has(norm(tag("title")));
    return type && +tag("congress") === own.congress && id !== bill && same ? [id] : [];
  });
}

/** BILLSTATUS can list one publication twice (once per action it relates to); each is kept once. */
export function parseListings(xml: string): Listing[] {
  const block = xml.match(/<cboCostEstimates>([\s\S]*?)<\/cboCostEstimates>/)?.[1] ?? "";
  const seen = new Set<string>();
  return [...block.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
    const tag = (name: string) => decode(item!.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "");
    const url = tag("url").replace(/^http:/, "https:");
    const pubId = url.match(/cbo\.gov\/publication\/(\d+)/)?.[1];
    if (!pubId || seen.has(pubId)) return [];
    seen.add(pubId);
    return [{ url, pubId, title: tag("title"), description: tag("description"), pubDate: tag("pubDate") }];
  });
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&(\w+);/g, (m, e) => ENTITIES[e] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The GovInfo text version CBO's description points at: "As passed by the Senate on …" → es, "Public Law …" → enr.
 * Returns null for text that is not a bill version (an amendment posted by the Budget Committee).
 * `known` (the bill's versions, when ingest-bills has run) turns a guess that names no real version into null.
 */
export function versionCode(description: string, bill: BillId, known: string[] = []): string | null {
  const d = description.toLowerCase();
  const own = billRef(bill).type.startsWith("h") ? "h" : "s";
  let code: string | null = null;
  if (/public law|enacted|signed into law/.test(d)) code = "enr";
  else if (/passed by the house/.test(d)) code = own === "h" ? "eh" : "eah";
  else if (/passed by the senate/.test(d)) code = own === "s" ? "es" : "eas";
  else if (/reported by the senate|senate committee/.test(d) && /report/.test(d)) code = "rs";
  else if (/reported by the house|house committee/.test(d) && /report/.test(d)) code = "rh";
  else if (/as introduced/.test(d)) code = `i${own}`;
  return code && known.length && !known.includes(code) ? null : code;
}

export interface Baseline {
  baseline: "current-law" | "current-policy";
  label: string;
}

const MONTH =
  /relative to CBO['’]s ((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}) baseline/i;

/** Every dollar names its baseline. Current policy is the Senate's budget-enforcement baseline. */
export function baselineOf(listing: Listing, pdf: { month: string | null; enforcement: boolean } | null): Baseline {
  const text = `${listing.title} ${listing.description}`;
  const dynamic = /dynamic/i.test(listing.title) ? ", dynamic estimate" : "";
  if (
    /budget[- ]enforcement baseline|baseline used for budget enforcement|current[- ]policy baseline/i.test(text) ||
    (pdf?.enforcement && !MONTH.test(text))
  )
    return { baseline: "current-policy", label: `Senate budget-enforcement baseline (current policy)${dynamic}` };
  const month = text.match(MONTH)?.[1] ?? pdf?.month;
  return {
    baseline: "current-law",
    label: `${month ? `CBO ${month} baseline (current law)` : "CBO current-law baseline"}${dynamic}`,
  };
}
