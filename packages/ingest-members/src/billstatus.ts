import { join } from "node:path";
import { type BillId, billRef, billstatusUrl } from "@antibody/core";
import { paths } from "@antibody/core/node";
import { XMLParser } from "fast-xml-parser";
import { cached, FetchError } from "./fetch.ts";

const LISTS = new Set(["item", "recordedVote", "amendment", "action"]);
export const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  isArray: (name) => LISTS.has(name),
});

/**
 * GovInfo BILLSTATUS for a bill, cached in data/bills/billstatus/ (shared with ingest-bills).
 * Null while GovInfo has not published it yet (a bill introduced today).
 */
export async function billstatus(bill: BillId, refresh = false): Promise<BillStatus | null> {
  const { congress, type, number } = billRef(bill);
  const file = join(paths.raw("bills"), "billstatus", `BILLSTATUS-${congress}${type}${number}.xml`);
  const text = await cached(billstatusUrl(bill), file, refresh).catch((e) => {
    if (e instanceof FetchError && e.status === 404) return null;
    throw e;
  });
  return text === null ? null : (xml.parse(text).billStatus.bill as BillStatus);
}

export interface RecordedVote {
  rollNumber: string;
  url: string;
  chamber: "House" | "Senate";
  congress: string;
  sessionNumber: string;
  date: string;
}
export interface Sponsor {
  bioguideId: string;
  fullName: string;
  sponsorshipDate?: string;
  sponsorshipWithdrawnDate?: string;
  isOriginalCosponsor?: string;
}
export interface BillStatus {
  introducedDate?: string;
  sponsors?: { item?: Sponsor[] };
  cosponsors?: { item?: Sponsor[] };
}

/** Every roll call BILLSTATUS ties to the bill or one of its amendments, once each, wherever it sits in the tree. */
export function recordedVotes(b: BillStatus): RecordedVote[] {
  const found = new Map<string, RecordedVote>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object")
      for (const [k, v] of Object.entries(node))
        if (k === "recordedVote") for (const rv of v as RecordedVote[]) found.set(rv.url, rv);
        else walk(v);
  };
  walk(b);
  return [...found.values()];
}
