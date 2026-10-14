import { join } from "node:path";
import { CURRENT_CONGRESS, type Row } from "@antibody/core";
import { paths, readRows } from "@antibody/core/node";
import { cached } from "./fetch.ts";

const REPO = "unitedstates/congress-legislators";
const MIRROR = "https://unitedstates.github.io/congress-legislators";

interface Committee {
  type: "house" | "senate" | "joint";
  name: string;
  thomas_id: string;
  house_committee_id?: string;
  senate_committee_id?: string;
  url?: string;
  congresses?: number[];
  subcommittees?: { name: string; thomas_id: string }[];
}
interface Seat {
  bioguide?: string;
  name: string;
  title?: string;
  rank?: number;
}

/** congress.gov / BILLSTATUS `systemCode` ("ssbk00", "hsag15") → Thomas id ("SSBK", "HSAG15"), the committee: node key. */
export const committeeId = (systemCode: string) => systemCode.toUpperCase().replace(/00$/, "");

/** First and last day of a Congress: the 119th runs 2025-01-03 to 2027-01-03. */
export const congressSpan = (congress: number) => ({
  start: `${1787 + 2 * congress}-01-03`,
  end: `${1789 + 2 * congress}-01-03`,
});

function officialPage(c: Committee, sub?: string): string | null {
  if (c.type === "house" && c.house_committee_id)
    return `https://clerk.house.gov/committees/${c.house_committee_id}${sub ?? "00"}`;
  const senateId = c.senate_committee_id ?? (c.type === "senate" ? c.thomas_id : null);
  return senateId ? `https://www.senate.gov/general/committee_membership/committee_memberships_${senateId}.htm` : null;
}

const CHAMBER = { house: "House", senate: "Senate", joint: "Joint" } as const;

async function committeeList(refresh: boolean) {
  const out = new Map<string, { c: Committee; file: string }>();
  for (const file of ["committees-current", "committees-historical"])
    for (const c of JSON.parse(
      await cached(`${MIRROR}/${file}.json`, join(paths.raw("members"), `${file}.json`), refresh),
    ) as Committee[])
      if (!out.has(c.thomas_id)) out.set(c.thomas_id, { c, file });
  return out;
}

export async function committeeRows(refresh: boolean): Promise<Row<"committees">[]> {
  const rows: Row<"committees">[] = [];
  for (const { c, file } of (await committeeList(refresh)).values()) {
    const blob = `https://github.com/${REPO}/blob/main/${file}.yaml`;
    const current = file === "committees-current";
    const page = current ? officialPage(c) : null;
    rows.push({
      id: c.thomas_id,
      name: c.name,
      chamber: CHAMBER[c.type],
      parent_id: null,
      url: c.url ?? page,
      source_url: page ?? blob,
      source_locator: `congress-legislators ${file}.yaml, thomas_id ${c.thomas_id}`,
    });
    for (const s of c.subcommittees ?? []) {
      const subPage = current ? officialPage(c, s.thomas_id) : null;
      rows.push({
        id: `${c.thomas_id}${s.thomas_id}`,
        name: `${c.name}: ${s.name}`,
        chamber: CHAMBER[c.type],
        parent_id: c.thomas_id,
        url: subPage,
        source_url: subPage ?? blob,
        source_locator: `congress-legislators ${file}.yaml, thomas_id ${c.thomas_id}, subcommittee ${s.thomas_id}`,
      });
    }
  }
  return rows;
}

interface Commit {
  sha: string;
  commit: { committer: { date: string } };
}

async function commitsBefore(until: string): Promise<Commit[]> {
  const url = `https://api.github.com/repos/${REPO}/commits?path=committee-membership-current.yaml&until=${until}T00:00:00Z&per_page=10`;
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(url, {
    headers: { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<Commit[]>;
}

/**
 * The roster for one Congress, read from the congress-legislators membership file pinned to a commit: the latest
 * one for the current Congress; for a past Congress, the last full roster before the file was cleared at its end.
 */
async function snapshot(congress: number) {
  const until = congress >= CURRENT_CONGRESS ? new Date().toISOString().slice(0, 10) : congressSpan(congress).end;
  for (const commit of await commitsBefore(until)) {
    const file = join(paths.raw("members"), "membership", `${commit.sha}.yaml`);
    const raw = `https://raw.githubusercontent.com/${REPO}/${commit.sha}/committee-membership-current.yaml`;
    const roster = Bun.YAML.parse(await cached(raw, file)) as Record<string, Seat[]>;
    const seats = Object.values(roster).reduce((n, s) => n + (s?.length ?? 0), 0);
    if (seats > 1000) return { sha: commit.sha, date: commit.commit.committer.date.slice(0, 10), roster };
  }
  throw new Error(`no full committee roster for the ${congress}th Congress in the last 10 commits before ${until}`);
}

export async function committeeMemberRows(congress: number): Promise<Row<"committee_members">[]> {
  const { sha, date, roster } = await snapshot(congress);
  const committees = new Map((await readRows("committees")).map((c) => [c.id, c]));
  const blob = `https://github.com/${REPO}/blob/${sha}/committee-membership-current.yaml`;
  const rows: Row<"committee_members">[] = [];
  for (const [committee, seats] of Object.entries(roster))
    for (const s of seats ?? []) {
      if (!s.bioguide) continue;
      const official = congress >= CURRENT_CONGRESS ? committees.get(committee)?.url : null;
      rows.push({
        id: `${congress}:${committee}:${s.bioguide}`,
        committee_id: committee,
        bioguide: s.bioguide,
        role: s.title ?? null,
        congress,
        source_url: official?.match(/clerk\.house\.gov|senate\.gov/) ? official : blob,
        source_locator: `${committee}, ${s.name}${s.rank ? `, rank ${s.rank}` : ""}; roster as of ${date} (congress-legislators ${sha.slice(0, 7)})`,
      });
    }
  return rows;
}
