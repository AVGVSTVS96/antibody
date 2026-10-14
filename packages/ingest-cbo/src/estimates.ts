import { type BillId, billRef } from "@antibody/core";

/** One `<cboCostEstimates><item>` from BILLSTATUS: the publication and the bill version CBO says it scored. */
export interface Listing {
  url: string;
  pubId: string;
  title: string;
  description: string;
  pubDate: string;
}

export function parseListings(xml: string): Listing[] {
  const block = xml.match(/<cboCostEstimates>([\s\S]*?)<\/cboCostEstimates>/)?.[1] ?? "";
  return [...block.matchAll(/<item>([\s\S]*?)<\/item>/g)].flatMap(([, item]) => {
    const tag = (name: string) => decode(item!.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "");
    const url = tag("url").replace(/^http:/, "https:");
    const pubId = url.match(/cbo\.gov\/publication\/(\d+)/)?.[1];
    return pubId ? [{ url, pubId, title: tag("title"), description: tag("description"), pubDate: tag("pubDate") }] : [];
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
  if (/budget enforcement baseline|current[- ]policy baseline/i.test(text) || (pdf?.enforcement && !MONTH.test(text)))
    return { baseline: "current-policy", label: `Senate budget-enforcement baseline (current policy)${dynamic}` };
  const month = text.match(MONTH)?.[1] ?? pdf?.month;
  return {
    baseline: "current-law",
    label: `${month ? `CBO ${month} baseline (current law)` : "CBO current-law baseline"}${dynamic}`,
  };
}
