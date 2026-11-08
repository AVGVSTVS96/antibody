import { BILL_TYPES, billId } from "@antibody/core";
import type { BillId, BillType } from "@antibody/core";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";

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

const text = z.string().nullish().catch(null);

const items = <T extends z.ZodType>(item: T) =>
  z
    .object({ item: z.array(item) })
    .nullish()
    .catch(null)
    .transform((node) => node?.item ?? []);

const BillXml = z.object({
  congress: text,
  type: text,
  number: text,
  billType: text,
  billNumber: text,
  title: text,
  introducedDate: text,
  policyArea: z.object({ name: text }).nullish().catch(null),
  sponsors: items(z.object({ bioguideId: text, fullName: text, party: text, state: text })),
  titles: items(z.object({ titleType: text, title: text })),
  actions: items(
    z.object({
      actionDate: text,
      text,
      type: text,
      actionCode: text,
      recordedVotes: z
        .object({
          recordedVote: z.array(z.object({ chamber: text, rollNumber: text, url: text, date: text })),
        })
        .nullish()
        .catch(null),
    }),
  ),
  textVersions: items(z.object({ type: text, date: text, formats: items(z.object({ url: text })) })),
  cboCostEstimates: items(z.object({ url: text, title: text, description: text, pubDate: text })),
  amendments: z
    .object({
      amendment: z.array(
        z.object({
          type: text,
          number: text,
          purpose: text,
          description: text,
          submittedDate: text,
          proposedDate: text,
        }),
      ),
    })
    .nullish()
    .catch(null),
  laws: items(z.object({ type: text, number: text })),
});

const BillStatusXml = z.object({ billStatus: z.object({ bill: BillXml }) });

const str = (v: string | null | undefined): string | null => {
  const trimmed = v?.trim() ?? "";

  return trimmed === "" ? null : trimmed;
};

const day = (v: string | null | undefined): string | null => str(v)?.slice(0, 10) ?? null;

const billType = (type: string): BillType | null => BILL_TYPES.find((t) => t === type) ?? null;

const TYPES_LONGEST_FIRST = BILL_TYPES.toSorted((a, b) => b.length - a.length).join("|");
const PACKAGE = new RegExp(`BILLS-(\\d+)(${TYPES_LONGEST_FIRST})(\\d+)([a-z]+)\\b`, "u");

export function parsePackage(name: string): { bill: BillId; code: string } | null {
  const [, congress = "", typeCode = "", number = "", code = ""] = PACKAGE.exec(name) ?? [];
  const type = billType(typeCode);

  if (type === null) {
    return null;
  }

  return { bill: billId({ congress: +congress, type, number: +number }), code };
}

const isPortions = (t: { titleType?: string | null | undefined }) => /portions/iu.test(t.titleType ?? "");

export function parseBillStatus(xml: string): BillStatus {
  const doc = BillStatusXml.safeParse(parser.parse(xml));

  if (!doc.success) {
    throw new Error("not a BILLSTATUS document");
  }

  const { bill } = doc.data.billStatus;
  const typeCode = bill.type ?? bill.billType;
  const type = billType(String(typeCode).toLowerCase());

  if (type === null) {
    throw new Error(`BILLSTATUS has an unknown bill type: ${String(typeCode)}`);
  }

  const id = billId({ congress: Number(bill.congress), type, number: Number(bill.number ?? bill.billNumber) });

  const [sponsor] = bill.sponsors;
  const titles = bill.titles;
  const whole = titles.filter((t) => !isPortions(t));
  const final = titles.filter((t) => /ENR \(Enrolled\)|as Enacted/iu.test(t.titleType ?? ""));
  const popular = str(titles.find((t) => t.titleType === "Popular Titles")?.title);

  const shortTitle =
    final.length > 0 && final.every((t) => isPortions(t))
      ? popular
      : (str(whole.find((t) => /^Short Titles? .*as Enacted/iu.test(t.titleType ?? ""))?.title) ??
        str(whole.find((t) => /^Short Title/iu.test(t.titleType ?? ""))?.title) ??
        popular);

  const actions: Action[] = bill.actions.flatMap((a) => {
    const date = day(a.actionDate);

    if (date === null) {
      return [];
    }

    return [
      {
        date,
        text: str(a.text) ?? "",
        type: str(a.type) ?? "",
        code: str(a.actionCode),
        votes: (a.recordedVotes?.recordedVote ?? []).flatMap((v): RecordedVote[] => {
          const url = str(v.url);
          const voteDate = day(v.date);

          return url === null || voteDate === null
            ? []
            : [
                {
                  chamber: v.chamber === "Senate" ? "Senate" : "House",
                  roll: Number(v.rollNumber),
                  url,
                  date: voteDate,
                },
              ];
        }),
      },
    ];
  });

  const versions: TextVersion[] = [];

  for (const v of bill.textVersions) {
    const urls = v.formats.map((f) => str(f.url) ?? "");
    const xmlUrl = urls.find((u) => /\/xml\/BILLS-.*\.xml$/u.test(u)) ?? urls.find((u) => /BILLS-.*\.xml$/u.test(u));
    const pkg = xmlUrl === undefined || xmlUrl === "" ? null : parsePackage(xmlUrl);

    if (xmlUrl === undefined || pkg === null) {
      continue;
    }

    versions.push({ code: pkg.code, name: str(v.type) ?? pkg.code, date: day(v.date), xmlUrl });
  }

  versions.sort((a, b) => (b.date ?? "9999").localeCompare(a.date ?? "9999"));

  const cbo: CboEstimate[] = bill.cboCostEstimates.flatMap((c) => {
    const url = str(c.url);
    const publishedOn = day(c.pubDate);

    return url === null || publishedOn === null
      ? []
      : [{ url, title: str(c.title) ?? "", description: str(c.description), publishedOn }];
  });

  const amendments: Amendment[] = (bill.amendments?.amendment ?? []).map((a) => ({
    id: `${String(a.type).toLowerCase()}${String(a.number)}`,
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
    actions,
    versions,
    cbo,
    amendments,
    laws: bill.laws.map((l) => `${l.type === "Private Law" ? "Pvt.L." : "P.L."} ${String(l.number)}`),
  };
}
