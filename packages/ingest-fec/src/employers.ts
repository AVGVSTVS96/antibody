import type { Row } from "@antibody/core";
import { column, fecDate, imageUrl, rows } from "./bulk.ts";

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

const NOT_AN_EMPLOYER =
  /^(NONE|N ?A|RETIRED|SELF|SELF EMPLOYED|SELFEMPLOYED|NOT EMPLOYED|UNEMPLOYED|HOMEMAKER|STUDENT|DISABLED|REFUSED|REQUESTED|INFO(RMATION)? REQUESTED.*|BEST EFFORTS.*|NOT APPLICABLE|NULL|UNKNOWN|EMPLOYED|NO EMPLOYER|NOT EMPLOYED.*|RETIRED.*)$/u;

export function employerKey(raw: string): string | null {
  const words = raw
    .toUpperCase()
    .replaceAll("&", " AND ")
    .replaceAll(/[.']/gu, "")
    .replaceAll(/[^A-Z0-9 ]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);

  if (words[0] === "THE") {
    words.shift();
  }

  while (words.length > 1 && LEGAL.has(words.at(-1) ?? "")) {
    words.pop();
  }

  const key = words.join(" ");

  return key && !NOT_AN_EMPLOYER.test(key) ? key : null;
}

export const EMPLOYER_MIN_USD = 1000;

// https://www.fec.gov/campaign-finance-data/contributions-individuals-file-description/
const I = {
  CMTE_ID: 0,
  IMAGE_NUM: 4,
  TRANSACTION_TP: 5,
  EMPLOYER: 11,
  TRANSACTION_DT: 13,
  TRANSACTION_AMT: 14,
  MEMO_CD: 18,
} as const;

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

export async function memberCommittees(
  cycle: number,
  byFec: Map<string, string>,
  dir?: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();

  for await (const f of rows("ccl", cycle, { dir })) {
    const bioguide = byFec.get(f[0] ?? "");
    const principalOrAuthorized = f[5] === "P" || f[5] === "A";

    if (bioguide !== undefined && bioguide !== "" && principalOrAuthorized) {
      out.set(column(f, 3), bioguide);
    }
  }

  for await (const f of rows("cn", cycle, { dir })) {
    const bioguide = byFec.get(f[0] ?? "");
    const principalCommittee = f[9];

    if (bioguide !== undefined && bioguide !== "" && principalCommittee !== undefined && principalCommittee !== "") {
      out.set(principalCommittee, bioguide);
    }
  }

  return out;
}

export interface EmployerResult {
  rows: Row<"employer_contributions">[];
  stats: { kept: number; noEmployer: number; noEmployerUsd: number; groups: number; belowMin: number };
}

export async function aggregateEmployers(
  cycle: number,
  committees: Map<string, string>,
  minUsd: number,
  dir?: string,
): Promise<EmployerResult> {
  const groups = new Map<string, Group>();
  const stats = { kept: 0, noEmployer: 0, noEmployerUsd: 0, groups: 0, belowMin: 0 };

  for await (const f of rows("indiv", cycle, { firstField: new Set(committees.keys()), dir })) {
    if (!INDIVIDUAL_TYPES.has(f[I.TRANSACTION_TP] ?? "") || f[I.MEMO_CD] === "X") {
      continue;
    }

    const date = fecDate(f[I.TRANSACTION_DT]);
    const amount = Number(f[I.TRANSACTION_AMT]);

    if (date === null || !Number.isFinite(amount)) {
      continue;
    }

    stats.kept++;
    const employer = (f[I.EMPLOYER] ?? "").trim();
    const key = employerKey(employer);

    if (key === null) {
      stats.noEmployer++;
      stats.noEmployerUsd += amount;
      continue;
    }

    const committee = column(f, I.CMTE_ID);
    const bioguide = committees.get(committee);

    if (bioguide === undefined) {
      throw new Error(`indiv${String(cycle).slice(2)} line for committee ${committee}, which no member has`);
    }

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

    if (date < g.first) {
      g.first = date;
    }

    if (date > g.last) {
      g.last = date;
    }

    if (amount > g.largest) {
      g.largest = amount;
      g.largestImage = column(f, I.IMAGE_NUM);
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

    const spellings = [...g.spellings].toSorted((a, b) => b[1] - a[1]).map(([s]) => s);
    const committeeIds = [...g.committees].toSorted();
    const employer = spellings[0];

    if (employer === undefined) {
      throw new Error(`employer group ${g.key} has no spellings`);
    }

    const query = new URLSearchParams([
      ...committeeIds.map((c): [string, string] => ["committee_id", c]),
      ["contributor_employer", employer],
      ["two_year_transaction_period", String(cycle)],
    ]);

    out.push({
      id: `${cycle}:${g.bioguide}:${g.key.replaceAll(" ", "-")}`,
      bioguide: g.bioguide,
      cycle,
      committee_ids: committeeIds,
      employer,
      employer_key: g.key,
      spellings: spellings.slice(0, 5),
      amount_usd: Math.round(g.amount * 100) / 100,
      contributions: g.n,
      first: g.first,
      last: g.last,
      largest_usd: g.largest,
      largest_url: imageUrl(g.largestImage),
      source_url: `https://www.fec.gov/data/receipts/individual-contributions/?${query.toString()}`,
      source_locator: `sum of ${g.n} itemized contributions (types 15, 15E, 15J; memo lines excluded) whose employer normalizes to "${g.key}"; FEC bulk indiv${String(cycle).slice(2)}`,
    });
  }

  return { rows: out, stats };
}
