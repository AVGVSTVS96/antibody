import type { Row } from "@antibody/core";
import { fecDate, imageUrl, rows } from "./bulk.ts";

const LEGAL = new Set([
  "INC",
  "INCORPORATED",
  "LLC",
  "LLP",
  "LP",
  "LTD",
  "LIMITED",
  "CORP",
  "CORPORATION",
  "CO",
  "COMPANY",
  "PLLC",
  "PC",
  "PA",
  "NA",
  "PLC",
]);

/** Answers that name no organization: retired, self-employed, unemployed, students, homemakers, "information requested". */
const NOT_AN_EMPLOYER =
  /^(NONE|N ?A|RETIRED|SELF|SELF EMPLOYED|SELFEMPLOYED|NOT EMPLOYED|UNEMPLOYED|HOMEMAKER|STUDENT|DISABLED|REFUSED|REQUESTED|INFO(RMATION)? REQUESTED.*|BEST EFFORTS.*|NOT APPLICABLE|NULL|UNKNOWN|EMPLOYED|NO EMPLOYER|NOT EMPLOYED.*|RETIRED.*)$/;

/**
 * Groups spellings of one employer: upper case, "&" as AND, punctuation dropped, a leading THE and trailing legal
 * suffixes removed ("Google LLC", "GOOGLE, INC." → "GOOGLE"). Null when the answer names no organization.
 */
export function employerKey(raw: string): string | null {
  const words = raw
    .toUpperCase()
    .replaceAll("&", " AND ")
    .replace(/[.']/g, "")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words[0] === "THE") words.shift();
  while (words.length > 1 && LEGAL.has(words.at(-1)!)) words.pop();
  const key = words.join(" ");
  return key && !NOT_AN_EMPLOYER.test(key) ? key : null;
}

/** The published floor: an employer's itemized total to one member in one cycle must reach this to be written. */
export const EMPLOYER_MIN_USD = 1000;

/** itcont.txt columns, from https://www.fec.gov/campaign-finance-data/contributions-individuals-file-description/ */
const I = {
  CMTE_ID: 0,
  IMAGE_NUM: 4,
  TRANSACTION_TP: 5,
  EMPLOYER: 11,
  TRANSACTION_DT: 13,
  TRANSACTION_AMT: 14,
  MEMO_CD: 18,
} as const;
/** Individual contributions a campaign itemizes: direct (15), earmarked through ActBlue/WinRed (15E), via joint fundraisers (15J). */
export const INDIVIDUAL_TYPES = new Set(["15", "15E", "15J"]);

interface Group {
  bioguide: string;
  key: string;
  amount: number;
  n: number;
  first: string;
  last: string;
  largest: number;
  largestImage: string;
  spellings: Map<string, number>;
  committees: Set<string>;
}

/** Candidate committees (principal and authorized) of members, for one cycle, from ccl + cn's principal committee. */
export async function memberCommittees(
  cycle: number,
  byFec: Map<string, string>,
  dir?: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for await (const f of rows("ccl", cycle, { dir })) {
    const bioguide = byFec.get(f[0]!);
    if (bioguide && (f[5] === "P" || f[5] === "A")) out.set(f[3]!, bioguide);
  }
  for await (const f of rows("cn", cycle, { dir })) {
    const bioguide = byFec.get(f[0]!);
    if (bioguide && f[9]) out.set(f[9], bioguide);
  }
  return out;
}

export interface EmployerResult {
  rows: Row<"employer_contributions">[];
  stats: { kept: number; noEmployer: number; noEmployerUsd: number; groups: number; belowMin: number };
}

/**
 * Streams one cycle's itemized individual contributions (2-6 GB zipped), keeps those to members' campaign committees,
 * and sums them per member and employer. Groups under `minUsd` are counted, not written.
 */
export async function aggregateEmployers(
  cycle: number,
  committees: Map<string, string>,
  minUsd: number,
  dir?: string,
): Promise<EmployerResult> {
  const groups = new Map<string, Group>();
  const stats = { kept: 0, noEmployer: 0, noEmployerUsd: 0, groups: 0, belowMin: 0 };
  for await (const f of rows("indiv", cycle, { firstField: new Set(committees.keys()), dir })) {
    if (!INDIVIDUAL_TYPES.has(f[I.TRANSACTION_TP]!) || f[I.MEMO_CD] === "X") continue;
    const date = fecDate(f[I.TRANSACTION_DT]);
    const amount = Number(f[I.TRANSACTION_AMT]);
    if (!date || !Number.isFinite(amount)) continue;
    stats.kept++;
    const employer = (f[I.EMPLOYER] ?? "").trim();
    const key = employerKey(employer);
    if (!key) {
      stats.noEmployer++;
      stats.noEmployerUsd += amount;
      continue;
    }
    const committee = f[I.CMTE_ID]!;
    const bioguide = committees.get(committee)!;
    const id = `${bioguide}\t${key}`;
    let g = groups.get(id);
    if (!g) {
      g = {
        bioguide,
        key,
        amount: 0,
        n: 0,
        first: date,
        last: date,
        largest: -Infinity,
        largestImage: "",
        spellings: new Map(),
        committees: new Set(),
      };
      groups.set(id, g);
    }
    g.amount += amount;
    g.n++;
    if (date < g.first) g.first = date;
    if (date > g.last) g.last = date;
    if (amount > g.largest) {
      g.largest = amount;
      g.largestImage = f[I.IMAGE_NUM]!;
    }
    g.spellings.set(employer, (g.spellings.get(employer) ?? 0) + amount);
    g.committees.add(committee);
  }
  stats.groups = groups.size;
  const out: Row<"employer_contributions">[] = [];
  for (const g of groups.values()) {
    if (g.amount < minUsd) {
      stats.belowMin++;
      continue;
    }
    const spellings = [...g.spellings].sort((a, b) => b[1] - a[1]).map(([s]) => s);
    const committeeIds = [...g.committees].sort();
    const query = new URLSearchParams([
      ...committeeIds.map((c) => ["committee_id", c]),
      ["contributor_employer", spellings[0]!],
      ["two_year_transaction_period", String(cycle)],
    ]);
    out.push({
      id: `${cycle}:${g.bioguide}:${g.key.replaceAll(" ", "-")}`,
      bioguide: g.bioguide,
      cycle,
      committee_ids: committeeIds,
      employer: spellings[0]!,
      employer_key: g.key,
      spellings: spellings.slice(0, 5),
      amount_usd: Math.round(g.amount * 100) / 100,
      contributions: g.n,
      first: g.first,
      last: g.last,
      largest_usd: g.largest,
      largest_url: imageUrl(g.largestImage),
      source_url: `https://www.fec.gov/data/receipts/individual-contributions/?${query}`,
      source_locator: `sum of ${g.n} itemized contributions (types 15, 15E, 15J; memo lines excluded) whose employer normalizes to "${g.key}"; FEC bulk indiv${String(cycle).slice(2)}`,
    });
  }
  return { rows: out, stats };
}
