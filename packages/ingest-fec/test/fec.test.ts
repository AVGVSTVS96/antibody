import { expect, test } from "bun:test";
import { join } from "node:path";
import { TABLES } from "@antibody/core";

/** Real FEC bulk lines for Rep. Sean Casten (H8IL06139, committee C00648493), plus a few edge cases, zipped like the originals. */
process.env.ANTIBODY_DATA = join(import.meta.dir, "fixtures");
const { cyclesFor, fecDate } = await import("../src/bulk.ts");
const { aggregateEmployers, employerKey, memberCommittees } = await import("../src/employers.ts");
const { givingUrl, readPacs, readPas2 } = await import("../src/pas2.ts");

const byFec = new Map([
  ["H8IL06139", "C001117"],
  ["H4AR02141", "H001072"],
]);

test("cycles, dates and employer keys", () => {
  expect(cyclesFor(119)).toEqual([2024, 2026]);
  expect(cyclesFor(117)).toEqual([2020, 2022]);
  expect(fecDate("07222025")).toBe("2025-07-22");
  expect(fecDate("")).toBeNull();
  expect(employerKey("Crowe, L.L.P.")).toBe("CROWE");
  expect(employerKey("CROWE LLP")).toBe("CROWE");
  expect(employerKey("The Goldman Sachs Group, Inc.")).toBe("GOLDMAN SACHS GROUP");
  expect(employerKey("AT&T")).toBe("AT AND T");
  for (const none of ["N/A", "NOT-EMPLOYED", "Self-Employed", "RETIRED", "INFORMATION REQUESTED PER BEST EFFORTS", ""])
    expect(employerKey(none)).toBeNull();
});

test("pas2: direct PAC money and outside spending land in separate tables; memo and undated lines are counted", async () => {
  const { contributions, independent, skipped } = await readPas2(2026, byFec);
  expect(contributions.map((c) => [c.pac_id, c.bioguide, c.amount_usd, c.date])).toEqual([
    ["C00165589", "C001117", 2000, "2025-07-22"],
    ["C00165589", "C001117", 2000, "2026-03-26"],
  ]);
  expect(contributions[0]!.recipient_committee_id).toBe("C00648493");
  expect(independent).toEqual([expect.objectContaining({ pac_id: "C00030718", support: "support", amount_usd: 4287 })]);
  expect(skipped).toEqual({ memo: 1, badDate: 1 });
  for (const r of contributions) expect(TABLES.contributions.schema.safeParse(r).success).toBe(true);
  for (const r of independent) expect(TABLES.independent_expenditures.schema.safeParse(r).success).toBe(true);
  expect(givingUrl("C00165589", "C00648493", "H8IL06139", 2026)).toContain("recipient_committee_id=C00648493");

  const pacs = await readPacs([2026], new Set(["C00165589"]));
  expect(pacs).toEqual([expect.objectContaining({ id: "C00165589", connected_org: "HUNTINGTON BANCSHARES INC." })]);
});

test("indiv: spellings of one employer are summed per member, memo lines and non-employers left out", async () => {
  const committees = await memberCommittees(2026, byFec);
  expect([...committees]).toEqual([["C00648493", "C001117"]]);
  const { rows, stats } = await aggregateEmployers(2026, committees, 0);
  const crowe = rows.find((r) => r.employer_key === "CROWE")!;
  expect(crowe).toMatchObject({
    id: "2026:C001117:CROWE",
    amount_usd: 1300,
    contributions: 3,
    employer: "Crowe, L.L.P.",
    spellings: ["Crowe, L.L.P.", "CROWE LLP"],
    first: "2025-05-23",
    last: "2025-06-23",
    largest_usd: 900,
  });
  expect(rows.map((r) => r.employer_key).sort()).toEqual(["BRATTLE GROUP", "CROWE"]);
  expect(stats).toMatchObject({ kept: 5, noEmployer: 1, belowMin: 0 });
  for (const r of rows) expect(TABLES.employer_contributions.schema.safeParse(r).success).toBe(true);
  expect((await aggregateEmployers(2026, committees, 1000)).rows.map((r) => r.employer_key).sort()).toEqual([
    "BRATTLE GROUP",
    "CROWE",
  ]);
});
