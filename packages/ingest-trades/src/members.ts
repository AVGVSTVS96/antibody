import { exists } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "@antibody/core/node";
import { z } from "zod";
import { download } from "./http.ts";

const LegislatorsFile = z.array(
  z.object({
    id: z.object({ bioguide: z.string() }),
    name: z.object({ first: z.string(), last: z.string(), nickname: z.string().optional() }),
    terms: z.array(
      z.object({
        type: z.enum(["rep", "sen"]),
        start: z.string(),
        end: z.string(),
        state: z.string(),
        district: z.number().optional(),
      }),
    ),
  }),
);

type Legislator = z.infer<typeof LegislatorsFile>[number];

type Term = Legislator["terms"][number];

const SOURCE = "https://unitedstates.github.io/congress-legislators";
const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv"]);

export const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replaceAll(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z ]/gu, " ")
    .split(/\s+/u)
    .filter((w) => w !== "" && !SUFFIX.has(w));

async function legislators(): Promise<Legislator[]> {
  const out: Legislator[] = [];

  for (const name of ["legislators-current.json", "legislators-historical.json"]) {
    const file = join(paths.raw("trades"), name);

    if (!(await exists(file)) && !(await download(`${SOURCE}/${name}`, file))) {
      throw new Error(`could not fetch ${name}`);
    }

    out.push(...LegislatorsFile.parse(await Bun.file(file).json()));
  }

  return out.filter((p) => p.terms.some((t) => t.end >= "2018-01-01"));
}

const shift = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString().slice(0, 10);

const surnameFits = (p: Legislator, last: string) => {
  const mine = norm(p.name.last).join(" ");

  return norm(last).some((w) => w.length > 1 && mine.split(" ").includes(w));
};

const firstFits = (p: Legislator, first: string) => {
  const mine = norm(`${p.name.first} ${p.name.nickname ?? ""}`);

  return norm(first).some((w) => mine.includes(w));
};

const serving = (p: Legislator, type: Term["type"], filed: string | null, where?: (t: Term) => boolean) =>
  p.terms.some(
    (t) =>
      t.type === type &&
      (filed === null || filed === "" || (t.start <= filed && t.end >= shift(filed, -400))) &&
      (where === undefined || where(t)),
  );

const one = (cands: Legislator[]) => (new Set(cands.map((p) => p.id.bioguide)).size === 1 ? (cands[0] ?? null) : null);

export async function memberMatcher() {
  const people = await legislators();

  return {
    house(last: string, first: string, stateDst: string, filed: string | null): string | null {
      const state = stateDst.slice(0, 2);
      const district = Number(stateDst.slice(2)) || 0;

      const inSeat = people.filter((p) =>
        serving(p, "rep", filed, (t) => t.state === state && (t.district ?? 0) === district),
      );

      const inState = people.filter((p) => serving(p, "rep", filed, (t) => t.state === state));

      const pick =
        one(inSeat.filter((p) => surnameFits(p, last))) ??
        one(inState.filter((p) => surnameFits(p, last))) ??
        one(inState.filter((p) => surnameFits(p, last) && firstFits(p, first)));

      return pick?.id.bioguide ?? null;
    },
    senate(last: string, first: string, filed: string | null): string | null {
      const cands = people.filter((p) => serving(p, "sen", filed) && surnameFits(p, last));
      const pick = one(cands) ?? one(cands.filter((p) => firstFits(p, first)));

      return pick?.id.bioguide ?? null;
    },
  };
}
