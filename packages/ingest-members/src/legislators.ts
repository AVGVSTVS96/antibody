import { join } from "node:path";
import type { Row } from "@antibody/core";
import { paths, readRows } from "@antibody/core/node";
import { cached } from "./fetch.ts";

const MIRROR = "https://unitedstates.github.io/congress-legislators";
const FILES = ["legislators-current", "legislators-historical"] as const;
/** GovInfo BILLSTATUS starts with the 108th Congress; keep everyone who served from the 103rd on. */
const SINCE = "1993-01-03";

interface Term {
  type: "rep" | "sen";
  start: string;
  end: string;
  state: string;
  district?: number;
  party?: string;
  caucus?: string;
  party_affiliations?: { start: string; end: string; party: string; caucus?: string }[];
}
interface Person {
  id: { bioguide: string; lis?: string; fec?: string[] };
  name: { first: string; last: string; official_full?: string; nickname?: string };
  terms: Term[];
}

export type MemberRow = Row<"members">;
type MemberTerm = MemberRow["terms"][number];

const PARTY: Record<string, "R" | "D"> = { Republican: "R", Democrat: "D" };
export const partyLetter = (party: string): "R" | "D" | "I" => PARTY[party] ?? "I";

/** Splits terms at mid-term party switches (Sinema, Manchin, Van Drew) so each row has one party. */
function expandTerms(terms: Term[]): MemberTerm[] {
  return terms.flatMap((t) => {
    const base = {
      chamber: t.type === "sen" ? ("Senate" as const) : ("House" as const),
      state: t.state,
      district: t.type === "rep" ? (t.district ?? null) : null,
    };
    const spans = t.party_affiliations ?? [{ start: t.start, end: t.end, party: t.party ?? "", caucus: t.caucus }];
    return spans.map((a) => ({ ...base, start: a.start, end: a.end, party: a.party, caucus: a.caucus ?? null }));
  });
}

export function memberRow(p: Person, file: string): MemberRow {
  const terms = expandTerms(p.terms);
  const last = terms.at(-1)!;
  return {
    id: p.id.bioguide,
    name: p.name.official_full ?? `${p.name.nickname ?? p.name.first} ${p.name.last}`,
    party: partyLetter(last.party),
    state: last.state,
    district: last.district,
    chamber: last.chamber,
    fec_candidate_ids: p.id.fec ?? [],
    lis_id: p.id.lis ?? null,
    terms,
    source_url: `https://bioguide.congress.gov/search/bio/${p.id.bioguide}`,
    source_locator: `congress-legislators ${file}.yaml, id.bioguide ${p.id.bioguide}`,
  };
}

/** Everyone who served since 1993, from the unitedstates/congress-legislators data (bioguide ↔ FEC ↔ LIS ids, terms). */
export async function fetchMembers(refresh: boolean): Promise<MemberRow[]> {
  const rows = new Map<string, MemberRow>();
  for (const file of FILES) {
    const text = await cached(`${MIRROR}/${file}.json`, join(paths.raw("members"), `${file}.json`), refresh);
    for (const p of JSON.parse(text) as Person[])
      if (p.terms.at(-1)!.end >= SINCE && !rows.has(p.id.bioguide)) rows.set(p.id.bioguide, memberRow(p, file));
  }
  return [...rows.values()];
}

/** The term a member held on a date (a bill's vote or introduction), or their last one before it. */
export function termOn(member: Pick<MemberRow, "terms">, date: string): MemberTerm {
  return member.terms.findLast((t) => t.start <= date) ?? member.terms[0]!;
}

export interface Lookup {
  byBioguide: Map<string, MemberRow>;
  byLis: Map<string, string>;
  byFec: Map<string, string>;
}

export async function memberLookup(): Promise<Lookup> {
  const members = await readRows("members");
  if (!members.length) throw new Error("no members rows yet: run the members stage first");
  return {
    byBioguide: new Map(members.map((m) => [m.id, m])),
    byLis: new Map(members.flatMap((m) => (m.lis_id ? [[m.lis_id, m.id] as const] : []))),
    byFec: new Map(members.flatMap((m) => m.fec_candidate_ids.map((f) => [f, m.id] as const))),
  };
}
