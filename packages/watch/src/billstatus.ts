import { BILL_TYPES, type BillId, type BillType, billId } from "@antibody/core";
import { XMLParser } from "fast-xml-parser";

export interface RecordedVote {
  chamber: "House" | "Senate";
  roll: number;
  url: string;
  date: string;
}

export interface Action {
  date: string;
  text: string;
  type: string;
  code: string | null;
  votes: RecordedVote[];
}

export interface TextVersion {
  /** GovInfo version code: ih, rh, eh, eas, enr … */
  code: string;
  name: string;
  date: string | null;
  xmlUrl: string;
}

export interface CboEstimate {
  url: string;
  title: string;
  description: string | null;
  publishedOn: string;
}

export interface Amendment {
  id: string;
  purpose: string | null;
  submittedOn: string | null;
}

export interface Sponsor {
  bioguide: string;
  name: string;
  party: string;
  state: string;
}

export interface BillStatus {
  id: BillId;
  title: string;
  shortTitle: string | null;
  introducedOn: string | null;
  policyArea: string | null;
  sponsor: Sponsor | null;
  actions: Action[];
  /** Newest first; enrolled versions carry no date on GovInfo and sort first. */
  versions: TextVersion[];
  cbo: CboEstimate[];
  amendments: Amendment[];
  laws: string[];
}

const ARRAYS = new Set(["item", "amendment", "recordedVote"]);
const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ARRAYS.has(name),
});

// biome-ignore lint/suspicious/noExplicitAny: parsed XML is untyped until read into BillStatus
type X = any;
const items = (node: X): X[] => node?.item ?? [];
const str = (v: X): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const day = (v: X): string | null => str(v)?.slice(0, 10) ?? null;

const TYPES_LONGEST_FIRST = [...BILL_TYPES].sort((a, b) => b.length - a.length).join("|");
const PACKAGE = new RegExp(`BILLS-(\\d+)(${TYPES_LONGEST_FIRST})(\\d+)([a-z]+)\\b`);

/** `BILLS-119hr1eas` → {bill: 119-hr-1, code: eas} */
export function parsePackage(name: string): { bill: BillId; code: string } | null {
  const m = name.match(PACKAGE);
  if (!m) return null;
  return { bill: billId({ congress: +m[1]!, type: m[2] as BillType, number: +m[3]! }), code: m[4]! };
}

export function parseBillStatus(xml: string): BillStatus {
  const bill: X = parser.parse(xml).billStatus?.bill;
  if (!bill) throw new Error("not a BILLSTATUS document");
  const id = billId({
    congress: +bill.congress,
    type: String(bill.type).toLowerCase() as BillType,
    number: +bill.number,
  });

  const sponsor = items(bill.sponsors)[0];
  const titles = items(bill.titles);
  const shortTitle =
    str(titles.find((t: X) => /^Short Title/i.test(t.titleType ?? ""))?.title) ??
    str(titles.find((t: X) => /^Short Titles? as/i.test(t.titleType ?? ""))?.title);

  const actions: Action[] = items(bill.actions).map((a: X) => ({
    date: day(a.actionDate)!,
    text: str(a.text) ?? "",
    type: str(a.type) ?? "",
    code: str(a.actionCode),
    votes: (a.recordedVotes?.recordedVote ?? []).map((v: X) => ({
      chamber: v.chamber === "Senate" ? "Senate" : "House",
      roll: +v.rollNumber,
      url: str(v.url)!,
      date: day(v.date)!,
    })),
  }));

  const versions: TextVersion[] = [];
  for (const v of items(bill.textVersions)) {
    const urls: string[] = items(v.formats).map((f: X) => str(f.url) ?? "");
    const xmlUrl = urls.find((u) => /\/xml\/BILLS-.*\.xml$/.test(u)) ?? urls.find((u) => /BILLS-.*\.xml$/.test(u));
    const pkg = xmlUrl && parsePackage(xmlUrl);
    if (!xmlUrl || !pkg) continue;
    versions.push({ code: pkg.code, name: str(v.type) ?? pkg.code, date: day(v.date), xmlUrl });
  }
  versions.sort((a, b) => (b.date ?? "9999").localeCompare(a.date ?? "9999"));

  const cbo: CboEstimate[] = items(bill.cboCostEstimates).map((c: X) => ({
    url: str(c.url)!,
    title: str(c.title) ?? "",
    description: str(c.description),
    publishedOn: day(c.pubDate)!,
  }));

  const amendments: Amendment[] = (bill.amendments?.amendment ?? []).map((a: X) => ({
    id: `${String(a.type).toLowerCase()}${a.number}`,
    purpose: str(a.purpose) ?? str(a.description),
    submittedOn: day(a.submittedDate) ?? day(a.proposedDate),
  }));

  return {
    id,
    title: str(bill.title) ?? "",
    shortTitle: shortTitle ?? null,
    introducedOn: day(bill.introducedDate),
    policyArea: str(bill.policyArea?.name),
    sponsor: sponsor
      ? {
          bioguide: str(sponsor.bioguideId) ?? "",
          name: str(sponsor.fullName) ?? "",
          party: str(sponsor.party) ?? "",
          state: str(sponsor.state) ?? "",
        }
      : null,
    actions: actions.filter((a) => a.date),
    versions,
    cbo: cbo.filter((c) => c.url && c.publishedOn),
    amendments,
    laws: items(bill.laws).map((l: X) => `${l.type === "Private Law" ? "Pvt.L." : "P.L."} ${l.number}`),
  };
}
