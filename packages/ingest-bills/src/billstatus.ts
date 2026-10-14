import { type BillId, billRef } from "@antibody/core";
import { all, at, type Element, first, parseXml, textOf } from "./xml.ts";

export interface Action {
  date: string;
  text: string;
  code: string | null;
  votes: RecordedVote[];
}

export interface RecordedVote {
  chamber: "House" | "Senate";
  congress: number;
  session: number;
  roll: number;
  url: string | null;
}

export interface TextVersionRef {
  name: string;
  date: string | null;
  urls: string[];
}

export interface AmendmentRecord {
  type: string;
  number: string;
  congress: number;
  chamber: "House" | "Senate";
  sponsorBioguide: string | null;
  sponsorName: string | null;
  /** Thomas code when a committee offered it (House Rules Committee substitutes have no member sponsor). */
  sponsorCommittee: string | null;
  purpose: string | null;
  latestAction: { date: string; text: string } | null;
  actions: Action[];
  submittedOn: string | null;
  /** The amendment this one amends (second-degree amendments to a substitute). */
  amends: string | null;
}

export interface Committee {
  code: string;
  name: string;
  chamber: string;
  activities: { name: string; date: string | null }[];
}

export interface BillStatus {
  id: BillId;
  congress: number;
  title: string;
  shortTitle: string | null;
  introducedOn: string | null;
  policyArea: string | null;
  sponsor: string | null;
  cosponsors: { bioguide: string; date: string | null; withdrawnOn: string | null }[];
  committees: Committee[];
  law: string | null;
  lawOn: string | null;
  latestAction: { date: string; text: string } | null;
  actions: Action[];
  textVersions: TextVersionRef[];
  amendments: AmendmentRecord[];
  related: { id: BillId; title: string | null; relationship: string[] }[];
  updatedAt: string | null;
}

/** GovInfo stamps dates as UTC instants of Eastern midnight (`2025-06-17T04:00:00Z`); this is the Eastern calendar day. */
export function easternDate(s: string | null): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function actions(e: Element, path: string): Action[] {
  return all(e, path).map((a) => ({
    date: easternDate(at(a, "actionDate")) ?? "",
    text: at(a, "text") ?? "",
    code: at(a, "actionCode"),
    votes: all(a, "recordedVotes/recordedVote").map((v) => ({
      chamber: at(v, "chamber") === "House" ? "House" : "Senate",
      congress: Number(at(v, "congress")),
      session: Number(at(v, "sessionNumber")),
      roll: Number(at(v, "rollNumber")),
      url: at(v, "url"),
    })),
  }));
}

function latest(e: Element): { date: string; text: string } | null {
  const text = at(e, "latestAction/text");
  return text ? { date: easternDate(at(e, "latestAction/actionDate")) ?? "", text } : null;
}

/** Thomas code as congress-legislators writes it: `hsbu00` → `HSBU`, `ssfi12` → `SSFI12`. */
export function thomasCode(systemCode: string): string {
  return systemCode.toUpperCase().replace(/00$/, "");
}

/**
 * A committee-offered amendment's committee: the code its actions carry, or, for older House records that only name it,
 * the Rules Committee (the one committee whose self-executing substitutes BILLSTATUS lists as amendments).
 */
function committeeSponsor(a: Element): string | null {
  const code = first(a, "actions/actions/item/committees/item/systemCode");
  if (code) return thomasCode(textOf(code).trim());
  return at(a, "sponsors/item/name") === "Rules Committee" ? "HSRU" : null;
}

function shortTitle(titles: { type: string; title: string }[]): string | null {
  const whole = titles.filter((t) => !/portions/i.test(t.type));
  return (
    whole.find((t) => /^Short Titles? .*as Enacted/i.test(t.type))?.title ??
    whole.find((t) => /^Short Title/i.test(t.type))?.title ??
    titles.find((t) => t.type === "Popular Titles")?.title ??
    null
  );
}

export function parseBillStatus(xml: string, id: BillId): BillStatus {
  const b = first(parseXml(xml), "bill");
  if (!b) throw new Error(`BILLSTATUS for ${id} has no <bill>`);
  const titles = all(b, "titles/item").map((t) => ({ type: at(t, "titleType") ?? "", title: at(t, "title") ?? "" }));
  const display = at(b, "title") ?? "";
  const lawNumber = at(b, "laws/item/number");
  const acts = actions(b, "actions/item");
  const lawAction = acts.find((a) => /^Became (Public|Private) Law/.test(a.text));

  return {
    id,
    congress: billRef(id).congress,
    title: titles.find((t) => t.type.startsWith("Official Title"))?.title ?? display,
    shortTitle: shortTitle(titles) ?? (display.length < 80 ? display : null),
    introducedOn: easternDate(at(b, "introducedDate")),
    policyArea: at(b, "policyArea/name"),
    sponsor: at(b, "sponsors/item/bioguideId"),
    cosponsors: all(b, "cosponsors/item").map((c) => ({
      bioguide: at(c, "bioguideId") ?? "",
      date: easternDate(at(c, "sponsorshipDate")),
      withdrawnOn: easternDate(at(c, "sponsorshipWithdrawnDate")),
    })),
    committees: all(b, "committees/item").flatMap((c) => {
      const own = (e: Element, chamber: string): Committee => ({
        code: thomasCode(at(e, "systemCode") ?? ""),
        name: at(e, "name") ?? "",
        chamber,
        activities: all(e, "activities/item").map((a) => ({
          name: at(a, "name") ?? "",
          date: easternDate(at(a, "date")),
        })),
      });
      const chamber = at(c, "chamber") ?? "";
      return [own(c, chamber), ...all(c, "subcommittees/item").map((s) => own(s, chamber))];
    }),
    law: lawNumber ? `${at(b, "laws/item/type") === "Private Law" ? "Pvt.L." : "P.L."} ${lawNumber}` : null,
    lawOn: lawAction?.date ?? null,
    latestAction: latest(b),
    actions: acts,
    textVersions: all(b, "textVersions/item").map((v) => ({
      name: at(v, "type") ?? "",
      date: easternDate(at(v, "date")),
      urls: all(v, "formats/item")
        .map((f) => at(f, "url"))
        .filter((u): u is string => !!u),
    })),
    amendments: all(b, "amendments/amendment").map((a) => {
      const type = at(a, "type") ?? "";
      return {
        type,
        number: at(a, "number") ?? "",
        congress: Number(at(a, "congress")),
        chamber: type.startsWith("H") ? "House" : "Senate",
        sponsorBioguide: at(a, "sponsors/item/bioguideId"),
        sponsorName: at(a, "sponsors/item/fullName") ?? at(a, "sponsors/item/name"),
        sponsorCommittee: at(a, "sponsors/item/bioguideId") ? null : committeeSponsor(a),
        purpose: at(a, "purpose") ?? at(a, "description"),
        latestAction: latest(a),
        actions: actions(a, "actions/actions/item"),
        submittedOn: easternDate(at(a, "submittedDate")),
        amends: at(a, "amendedAmendment/number")
          ? `${at(a, "amendedAmendment/type")} ${at(a, "amendedAmendment/number")}`
          : null,
      };
    }),
    related: all(b, "relatedBills/item").flatMap((r) => {
      const type = at(r, "type")?.toLowerCase();
      const number = at(r, "number");
      const congress = at(r, "congress");
      if (!type || !number || !congress) return [];
      return [
        {
          id: `${congress}-${type}-${number}` as BillId,
          title: at(r, "title"),
          relationship: all(r, "relationshipDetails/item").map((d) => at(d, "type") ?? ""),
        },
      ];
    }),
    updatedAt: at(b, "updateDateIncludingText") ?? at(b, "updateDate"),
  };
}
