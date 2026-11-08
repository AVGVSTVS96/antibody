import { join } from "node:path";
import type { Row } from "@antibody/core";
import { paths, readRows } from "@antibody/core/node";
import { z } from "zod";
import { cached } from "./fetch.ts";

const MIRROR = "https://unitedstates.github.io/congress-legislators";
const FILES = ["legislators-current", "legislators-historical"] as const;

const SINCE_103RD_CONGRESS = "1993-01-03";

const TermSchema = z.object({
  type: z.enum(["rep", "sen"]),
  start: z.string(),
  end: z.string(),
  state: z.string(),
  district: z.number().optional(),
  party: z.string().optional(),
  caucus: z.string().optional(),
  party_affiliations: z
    .array(z.object({ start: z.string(), end: z.string(), party: z.string(), caucus: z.string().optional() }))
    .optional(),
});

type Term = z.infer<typeof TermSchema>;

const PersonSchema = z.object({
  id: z.object({ bioguide: z.string(), lis: z.string().optional(), fec: z.array(z.string()).optional() }),
  name: z.object({
    first: z.string(),
    last: z.string(),
    official_full: z.string().optional(),
    nickname: z.string().optional(),
  }),
  terms: z.array(TermSchema).min(1),
});

type Person = z.infer<typeof PersonSchema>;

export type MemberRow = Row<"members">;

type MemberTerm = MemberRow["terms"][number];

export const partyLetter = (party: string): "R" | "D" | "I" =>
  party === "Republican" ? "R" : party === "Democrat" ? "D" : "I";

function splitAtPartySwitches(terms: Term[]): MemberTerm[] {
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
  const terms = splitAtPartySwitches(p.terms);
  const last = terms.at(-1);

  if (last === undefined) {
    throw new Error(`${p.id.bioguide} has no terms`);
  }

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

export async function fetchMembers(refresh: boolean): Promise<MemberRow[]> {
  const rows = new Map<string, MemberRow>();

  for (const file of FILES) {
    const text = await cached(`${MIRROR}/${file}.json`, join(paths.raw("members"), `${file}.json`), refresh);

    const people = z.array(PersonSchema).parse(JSON.parse(text));

    for (const p of people) {
      const servedSince103rd = (p.terms.at(-1)?.end ?? "") >= SINCE_103RD_CONGRESS;

      if (servedSince103rd && !rows.has(p.id.bioguide)) {
        rows.set(p.id.bioguide, memberRow(p, file));
      }
    }
  }

  return [...rows.values()];
}

export function termOn(member: Pick<MemberRow, "terms">, date: string): MemberTerm {
  const term = member.terms.findLast((t) => t.start <= date) ?? member.terms[0];

  if (term === undefined) {
    throw new Error("member has no terms");
  }

  return term;
}

export interface Lookup {
  byBioguide: Map<string, MemberRow>;
  byLis: Map<string, string>;
  byFec: Map<string, string>;
}

export async function memberLookup(): Promise<Lookup> {
  const members = await readRows("members");

  if (!members.length) {
    throw new Error("no members rows yet: run the members stage first");
  }

  return {
    byBioguide: new Map(members.map((m) => [m.id, m])),
    byLis: new Map(members.flatMap((m) => (m.lis_id === null || m.lis_id === "" ? [] : [[m.lis_id, m.id] as const]))),
    byFec: new Map(members.flatMap((m) => m.fec_candidate_ids.map((f) => [f, m.id] as const))),
  };
}
