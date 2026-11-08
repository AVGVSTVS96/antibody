import { join } from "node:path";
import { CURRENT_CONGRESS } from "@antibody/core";
import type { Row } from "@antibody/core";
import { paths, readRows } from "@antibody/core/node";
import { z } from "zod";
import { cached } from "./fetch.ts";

const REPO = "unitedstates/congress-legislators";
const MIRROR = "https://unitedstates.github.io/congress-legislators";

const CommitteeSchema = z.object({
  type: z.enum(["house", "senate", "joint"]),
  name: z.string(),
  thomas_id: z.string(),
  house_committee_id: z.string().optional(),
  senate_committee_id: z.string().optional(),
  url: z.string().optional(),
  congresses: z.array(z.number()).optional(),
  subcommittees: z.array(z.object({ name: z.string(), thomas_id: z.string() })).optional(),
});

type Committee = z.infer<typeof CommitteeSchema>;

const Seat = z.object({
  bioguide: z.string().optional(),
  name: z.string(),
  title: z.string().optional(),
  rank: z.number().optional(),
});

const Roster = z.record(
  z.string(),
  z
    .array(Seat)
    .nullable()
    .transform((seats) => seats ?? []),
);

const Commit = z.object({ sha: z.string(), commit: z.object({ committer: z.object({ date: z.string() }) }) });

export const committeeId = (systemCode: string) => systemCode.toUpperCase().replace(/00$/u, "");

export const congressSpan = (congress: number) => ({
  start: `${1787 + 2 * congress}-01-03`,
  end: `${1789 + 2 * congress}-01-03`,
});

function officialPage(c: Committee, sub?: string): string | null {
  if (c.type === "house" && c.house_committee_id !== undefined && c.house_committee_id !== "") {
    return `https://clerk.house.gov/committees/${c.house_committee_id}${sub ?? "00"}`;
  }

  const senateId = c.senate_committee_id ?? (c.type === "senate" ? c.thomas_id : null);

  return senateId !== null && senateId !== ""
    ? `https://www.senate.gov/general/committee_membership/committee_memberships_${senateId}.htm`
    : null;
}

const CHAMBER = { house: "House", senate: "Senate", joint: "Joint" } as const;

function listRows(list: Committee[], file: string, blob: string, current: boolean): Row<"committees">[] {
  return list.flatMap((c) => {
    const page = current ? officialPage(c) : null;

    const parent: Row<"committees"> = {
      id: c.thomas_id,
      name: c.name,
      chamber: CHAMBER[c.type],
      parent_id: null,
      url: c.url ?? page,
      source_url: page ?? blob,
      source_locator: `congress-legislators ${file}, thomas_id ${c.thomas_id}`,
    };

    return [
      parent,
      ...(c.subcommittees ?? []).map((sub) => {
        const subPage = current ? officialPage(c, sub.thomas_id) : null;

        return {
          ...parent,
          id: `${c.thomas_id}${sub.thomas_id}`,
          name: `${c.name}: ${sub.name}`,
          parent_id: c.thomas_id,
          url: subPage,
          source_url: subPage ?? blob,
          source_locator: `${parent.source_locator}, subcommittee ${sub.thomas_id}`,
        };
      }),
    ];
  });
}

export async function committeeRows(refresh: boolean): Promise<Row<"committees">[]> {
  const rows = new Map<string, Row<"committees">>();

  for (const file of ["committees-current", "committees-historical"]) {
    const text = await cached(`${MIRROR}/${file}.json`, join(paths.raw("members"), `${file}.json`), refresh);
    const blob = `https://github.com/${REPO}/blob/main/${file}.yaml`;

    const list = z.array(CommitteeSchema).parse(JSON.parse(text));

    for (const row of listRows(list, `${file}.yaml`, blob, file === "committees-current")) {
      if (!rows.has(row.id)) {
        rows.set(row.id, row);
      }
    }
  }

  return [...rows.values()];
}

async function commitsBefore(until: string) {
  const url = `https://api.github.com/repos/${REPO}/commits?path=committee-membership-current.yaml&until=${until}T00:00:00Z&per_page=10`;
  const token = process.env.GITHUB_TOKEN;

  const headers = new Headers({ accept: "application/vnd.github+json" });

  if (token !== undefined && token !== "") {
    headers.set("authorization", `Bearer ${token}`);
  }

  const res = await fetch(url, { headers });

  if (!res.ok) {
    throw new Error(`${res.status} ${url}`);
  }

  return z.array(Commit).parse(await res.json());
}

async function snapshot(congress: number) {
  const until = congress >= CURRENT_CONGRESS ? new Date().toISOString().slice(0, 10) : congressSpan(congress).end;

  for (const commit of await commitsBefore(until)) {
    const file = join(paths.raw("members"), "membership", `${commit.sha}.yaml`);
    const raw = `https://raw.githubusercontent.com/${REPO}/${commit.sha}/committee-membership-current.yaml`;
    const roster = new Map(Object.entries(Roster.parse(Bun.YAML.parse(await cached(raw, file)))));
    const seats = [...roster.values()].reduce((n, s) => n + s.length, 0);
    const clearedAtCongressEnd = seats <= 1000;

    if (!clearedAtCongressEnd) {
      return { sha: commit.sha, date: commit.commit.committer.date.slice(0, 10), roster };
    }
  }

  throw new Error(`no full committee roster for the ${congress}th Congress in the last 10 commits before ${until}`);
}

export async function committeeMemberRows(congress: number) {
  const { sha, date, roster } = await snapshot(congress);
  const committees = new Map((await readRows("committees")).map((c) => [c.id, c]));
  const blob = `https://github.com/${REPO}/blob/${sha}/committee-membership-current.yaml`;
  const seats = new Map<string, Row<"committee_members">>();

  for (const [committee, list] of roster) {
    for (const s of list) {
      if (s.bioguide === undefined || s.bioguide === "") {
        continue;
      }

      const id = `${congress}:${committee}:${s.bioguide}`;

      if (seats.has(id)) {
        continue;
      }

      seats.set(id, {
        id,
        committee_id: committee,
        bioguide: s.bioguide,
        role: s.title ?? null,
        congress,
        source_url: blob,
        source_locator: `${committee}, ${s.name}${s.rank === undefined || s.rank === 0 ? "" : `, rank ${s.rank}`}; roster as of ${date} (congress-legislators ${sha.slice(0, 7)})`,
      });
    }
  }

  const missing = [...roster.keys()].filter((id) => !committees.has(id));
  let added: Row<"committees">[] = [];

  if (missing.length > 0) {
    const raw = `https://raw.githubusercontent.com/${REPO}/${sha}/committees-current.yaml`;

    const list = z
      .array(CommitteeSchema)
      .parse(Bun.YAML.parse(await cached(raw, join(paths.raw("members"), "committees", `${sha}.yaml`))));

    const pinned = `https://github.com/${REPO}/blob/${sha}/committees-current.yaml`;
    added = listRows(list, `committees-current.yaml at ${sha.slice(0, 7)}`, pinned, false).filter((c) =>
      missing.includes(c.id),
    );
  }

  return { seats: [...seats.values()], committees: added };
}
