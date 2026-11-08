import { BILL_TYPES, billId, billRef } from "@antibody/core";
import type { BillId } from "@antibody/core";
import { all, at, first, parseXml, textOf } from "./xml.ts";
import type { Element } from "./xml.ts";

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
  sponsorCommittee: string | null;
  purpose: string | null;
  latestAction: { date: string; text: string } | null;
  actions: Action[];
  submittedOn: string | null;
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

export function easternDate(s: string | null): string | null {
  if (s === null || s === "") {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/u.test(s)) {
    return s;
  }

  const d = new Date(s);

  if (Number.isNaN(d.getTime())) {
    return null;
  }

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

  return text === null ? null : { date: easternDate(at(e, "latestAction/actionDate")) ?? "", text };
}

export function thomasCode(systemCode: string): string {
  return systemCode.toUpperCase().replace(/00$/u, "");
}

function committeeSponsor(a: Element): string | null {
  const code = first(a, "actions/actions/item/committees/item/systemCode");

  if (code) {
    return thomasCode(textOf(code).trim());
  }

  return at(a, "sponsors/item/name") === "Rules Committee" ? "HSRU" : null;
}

function committee(e: Element, chamber: string): Committee {
  return {
    code: thomasCode(at(e, "systemCode") ?? ""),
    name: at(e, "name") ?? "",
    chamber,
    activities: all(e, "activities/item").map((a) => ({
      name: at(a, "name") ?? "",
      date: easternDate(at(a, "date")),
    })),
  };
}

function shortTitle(titles: { type: string; title: string }[]): string | null {
  const final = titles.filter((t) => /ENR \(Enrolled\)|as Enacted/iu.test(t.type));

  if (final.length && final.every((t) => /portions/iu.test(t.type))) {
    return (
      titles.find((t) => t.type === "Override Display Title")?.title ??
      titles.find((t) => t.type === "Popular Titles")?.title ??
      null
    );
  }

  const whole = titles.filter((t) => !/portions/iu.test(t.type));

  return (
    titles.find((t) => t.type === "Override Display Title")?.title ??
    whole.find((t) => /^Short Titles? .*as Enacted/iu.test(t.type))?.title ??
    whole.find((t) => /^Short Title/iu.test(t.type))?.title ??
    titles.find((t) => t.type === "Popular Titles")?.title ??
    null
  );
}

export function parseBillStatus(xml: string, id: BillId): BillStatus {
  const b = first(parseXml(xml), "bill");

  if (!b) {
    throw new Error(`BILLSTATUS for ${id} has no <bill>`);
  }

  const titles = all(b, "titles/item").map((t) => ({ type: at(t, "titleType") ?? "", title: at(t, "title") ?? "" }));
  const display = at(b, "title") ?? "";
  const lawNumber = at(b, "laws/item/number");
  const acts = actions(b, "actions/item");
  const lawAction = acts.find((a) => /^Became (Public|Private) Law/u.test(a.text));

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
      const chamber = at(c, "chamber") ?? "";

      return [committee(c, chamber), ...all(c, "subcommittees/item").map((s) => committee(s, chamber))];
    }),
    law: lawNumber === null ? null : `${at(b, "laws/item/type") === "Private Law" ? "Pvt.L." : "P.L."} ${lawNumber}`,
    lawOn: lawAction?.date ?? null,
    latestAction: latest(b),
    actions: acts,
    textVersions: all(b, "textVersions/item").map((v) => ({
      name: at(v, "type") ?? "",
      date: easternDate(at(v, "date")),
      urls: all(v, "formats/item")
        .map((f) => at(f, "url"))
        .filter((u) => u !== null),
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
        sponsorCommittee: at(a, "sponsors/item/bioguideId") === null ? committeeSponsor(a) : null,
        purpose: at(a, "purpose") ?? at(a, "description"),
        latestAction: latest(a),
        actions: actions(a, "actions/actions/item"),
        submittedOn: easternDate(at(a, "submittedDate")),
        amends:
          at(a, "amendedAmendment/number") === null
            ? null
            : `${at(a, "amendedAmendment/type")} ${at(a, "amendedAmendment/number")}`,
      };
    }),
    related: all(b, "relatedBills/item").flatMap((r) => {
      const type = BILL_TYPES.find((t) => t === at(r, "type")?.toLowerCase());
      const number = at(r, "number");
      const congress = at(r, "congress");

      if (type === undefined || number === null || congress === null) {
        return [];
      }

      return [
        {
          id: billId({ congress: Number(congress), type, number: Number(number) }),
          title: at(r, "title"),
          relationship: all(r, "relationshipDetails/item").map((d) => at(d, "type") ?? ""),
        },
      ];
    }),
    updatedAt: at(b, "updateDateIncludingText") ?? at(b, "updateDate"),
  };
}
